import { MongoClient } from 'mongodb';
import SequelizeAuto from 'sequelize-auto';
import * as dataAnalyser from './dataAnalyser.js';
import * as generalHelper from './general.js';

export function getDatabaseSchemas(database, params) {
  if (database === 'mongodb') {
    return getMongodbSchemas(params);
  }
  else if (database === 'mysql') {
    return getMysqlSchemas(params);
  }
  return Promise.reject('This database is not available for the moment');
};

const getMongodbSchemas = params => {
  return new Promise(async (resolve, reject) => {

    if (!params.host) { return reject('host parameter is undefined'); }
    if (!params.name) { return reject('name parameter is undefined'); }

    await generalHelper.timeout(2000);

    const protocol = `mongodb${params.srv ? '+srv' : ''}`;
    const cred = `${params.user}${params.user ? ':' : ''}${params.password}`;
    const host = `${params.host}${!params.srv ? `:${params.port}` : ''}`;
    const dbAndParams = `${params.name}${params.ssl?'?ssl=true':''}`;
    const uri = `${protocol}://${cred}${cred ? '@' : ''}${host}/${dbAndParams}`;

    const client = await MongoClient.connect(uri, { useNewUrlParser: true })
      .catch(err => {
        reject(err.message);
        return null;
      });

    if (!client) {
      return;
    }

    // Connect to the proper db
    const db = client.db(params.name);

    const cleanSchemas = [];

    const collections = await db.listCollections().toArray();
    for (const collection of collections) {
      const collectionData = await db.collection(collection.name).find().limit(50).toArray();
      const cleanSchema = dataAnalyser.analyse(collectionData);

      cleanSchemas.push({
        collection: collection.name,
        schema: cleanSchema
      });
    }

    client.close();

    resolve(cleanSchemas);
  });
};

const getMysqlSchemas = params => {
  return new Promise(async (resolve, reject) => {

    if (!params.host) { return reject('host parameter is undefined'); }
    if (!params.name) { return reject('name parameter is undefined'); }

    const auto = new SequelizeAuto(params.name, params.user, params.password, {
      host: params.host,
      dialect: 'mysql', // 'mysql' | 'mariadb' | 'sqlite' | 'postgres' | 'mssql',
      // directory: './models-test', // where to write files
      noWrite: true,
      noInitModels: true,
      additional: {
        timestamps: false
      }
    });

    const cleanSchemas = [];

    // Connect to the database
    const data = await auto.run().catch(e => {
      console.log('===err', e);
    });

    if (!data) {
      return;
    }

    if (data && data.text) {
      const keys = Object.keys(data.text);
      keys.forEach(tableName => {
        if (tableName !== 'SequelizeMeta') {
          cleanSchemas.push({
            collection: tableName,
            schema: data.text[tableName]
          });
        }
      });
    }

    // console.log(cleanSchemas);

    resolve(cleanSchemas);
  });
};