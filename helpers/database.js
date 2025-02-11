const _ = require('lodash');
const { MongoClient } = require('mongodb');
const Sequelize = require('sequelize');
const SequelizeAuto = require('sequelize-auto');
// const fs = require('fs');

const dataAnalyser = require('./dataAnalyser.js');
const generalHelper = require('./general.js');

const sequelizeDialects = {
  mysql: 'mysql',
  postgresql: 'postgresql',
  mariadb: 'mariadb',
  // sqlite: 'sqlite',
  // mssql: 'mssql'
};

const getDatabaseSchemas = (database, params) => {
  if (database === 'mongodb') {
    return getMongodbSchemas(params);
  }
  else if (['mysql', 'postgresql'].includes(database)) {
    return getSQLSchemas(database, params);
  }
  return Promise.reject('This database is not available for the moment');
};

const getMongodbConnectionUrl = params => {
  const protocol = `mongodb${params.srv ? '+srv' : ''}`;
  const cred = `${params.user}${params.password ? ':' : ''}${params.password}`;
  const host = `${params.host}${!params.srv ? `:${params.port}` : ''}`;
  const dbAndParams = `${params.dbname}${params.ssl?'?ssl=true':''}`;
  const uri = `${protocol}://${cred}${cred ? '@' : ''}${host}/${dbAndParams}?authSource=admin`;
  return uri;
};

const getSQLConnectionUrl = (database, params) => {
  const protocol = sequelizeDialects[database];
  const cred = `${params.user}${params.password ? ':' : ''}${params.password}`;
  const host = `${params.host}:${params.port}`;
  const uri = `${protocol}://${cred}${cred ? '@' : ''}${host}/${params.dbname}`;
  return uri;
};

const getMatchingCollection = (datasets, idsToLookFor) => {
  let potentialCollection = '';
  Object.keys(datasets).forEach(collectionName => {
    const collectionData = datasets[collectionName];
    const allIds = collectionData.map(itemData => itemData._id.toString());
    idsToLookFor.forEach(value => {
      if (allIds.includes(value)) {
        potentialCollection = collectionName;
      }
    });
  });
  return potentialCollection;
};

const getRelationships = datasets => {
  const relationships = {};

  Object.keys(datasets).map(collectionName => {
    relationships[collectionName] = [];
    const foreignKeys = {};
    const collectionData = datasets[collectionName];

    collectionData.forEach(itemData => {
      Object.keys(itemData).map(fieldKey => {
        const checkForHexRegExp = new RegExp('^[0-9a-fA-F]{24}$');
        if (fieldKey !== '_id' && checkForHexRegExp.test(itemData[fieldKey])) {
          if (foreignKeys[fieldKey]) {
            foreignKeys[fieldKey].push(itemData[fieldKey].toString());
          }
          else {
            foreignKeys[fieldKey] = [itemData[fieldKey].toString()];
          }
        }
      });
    });

    Object.keys(foreignKeys).map(fieldKey => {
      const values = foreignKeys[fieldKey];
      const matchingCollection = getMatchingCollection(datasets, values);
      if (matchingCollection) {
        relationships[collectionName].push({ field: fieldKey, ref: matchingCollection });
      }
    });

  });

  return relationships;
};

const getMongodbSchemas = (params) => {
  return new Promise(async (resolve, reject) => {

    if (params.connection_method !== 'connection string' && !params.host) {
      return reject('host parameter is undefined');
    }
    if (params.connection_method !== 'connection string' && !params.dbname) {
      return reject('dbname parameter is undefined');
    }

    await generalHelper.timeout(2000);

    // Get mongodb connection url
    const uri = params.connection_method == 'connection string' ? params.connection_string : getMongodbConnectionUrl(params);

    const client = await MongoClient.connect(uri, { useNewUrlParser: true })
      .catch(err => {
        reject(err.message);
        return null;
      });


    if (!client) {
      return;
    }

    // Connect to the proper db
    const db = client.db(client.options.dbName);

    const datasets = {};
    const collections = await db.listCollections().toArray();
    for (const collection of collections) {
      const collectionData = await db.collection(collection.name).find().limit(50).toArray();
      datasets[collection.name] = collectionData;
    }

    // Find potential relationships
    const relationships = getRelationships(datasets);

    let cleanSchemas = [];
    Object.keys(datasets).map(collectionName => {
      const collectionData = datasets[collectionName];
      const cleanSchema = dataAnalyser.analyse(collectionData, relationships[collectionName]);
      cleanSchemas.push({
        collection: collectionName,
        schema: cleanSchema
      });
    });

    // Order by model name
    cleanSchemas = _.orderBy(cleanSchemas, ['collection'], ['asc']);

    client.close();

    resolve(cleanSchemas);
  });
};

const getSQLSchemas = (database, params) => {
  return new Promise(async (resolve, reject) => {

    if (!params.host) {
      return reject('host parameter is undefined');
    }
    if (!params.dbname) {
      return reject('dbname parameter is undefined');
    }
    if (!sequelizeDialects[database]) {
      return reject('undefined database dialect');
    }
    if (database === 'postgresql' && !params.schema) {
      return reject('database schema is mandatory for postgresql');
    }

    // Remove the protocol from the host
    if (params.host.indexOf('://') > -1) {
      params.host = params.host.substring(params.host.indexOf('://') + 3);
    }

    const dialectOptions = {};
    if (database === 'mysql' || database === 'mariadb') {
      dialectOptions.connectTimeout = 10000;
    }
    else if (database === 'postgresql') {
      dialectOptions.statement_timeout = 10000;
      dialectOptions.query_timeout = 10000;
      dialectOptions.idle_in_transaction_session_timeout = 10000;

      // dialectOptions.ssl = {
      //   rejectUnauthorized: false,
      //   ca: fs.readFileSync('./ca-certificate.crt').toString(),
      // };
    }

    const sqlConnectionUrl = getSQLConnectionUrl(database, params);
    const sequelize = new Sequelize(sqlConnectionUrl, {
      logging: false,
      dialectOptions
    });

    // Try database connection
    const reqCo = await sequelize.authenticate()
      .then(() => {
        return 'ok';
      })
      .catch(e => {
        return null;
      });

    if (!reqCo) {
      return reject('Please check your credentials');
    }

    const sequelizeAutoOptions = {
      directory: `${global.appRoot}/models-tmp`, // where to write files
      // noWrite: true,
      // noInitModels: true,
      additional: {
        timestamps: false
      }
    };

    // Add schema for postgreSQL
    if (database === 'postgresql') {
      sequelizeAutoOptions.schema = params.schema;
    }

    // Connect with SequelizeAuto
    const auto = new SequelizeAuto(sequelize, null, null, sequelizeAutoOptions);

    let cleanSchemas = [];

    // Connect to the database
    const data = await auto.run().catch(e => {
      console.log('===err', e);
    });

    if (!data) {
      return;
    }

    if (data && data.text) {
      Object.keys(data.text).forEach(tableName => {
        if (tableName === 'SequelizeMeta') {
          return;
        }
        // Remove schema name from table name "schema.table" => "table"
        const cleanTableName = tableName.substring(tableName.indexOf('.') + 1)
        cleanSchemas.push({
          collection: cleanTableName,
          schema: data.text[tableName]
        });
      });
      // Order by model name
      cleanSchemas = _.orderBy(cleanSchemas, ['collection'], ['asc']);
    }

    resolve(cleanSchemas);
  });
};

module.exports.getDatabaseSchemas = getDatabaseSchemas;
module.exports.getMongodbConnectionUrl = getMongodbConnectionUrl;
module.exports.getSQLConnectionUrl = getSQLConnectionUrl;