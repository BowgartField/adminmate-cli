import fs from 'fs';
import mkdirp from 'mkdirp';
import slugify from 'slugify';

import handlebars from './handlebars.js';

export async function createAdminTemplate(projectName, database, models) {
  await createTemplateStructure(projectName, database, models);
};

const createTemplateStructure = (projectName, database, models) => {
  return new Promise(async (resolve, reject) => {
    const cwd = process.cwd();
    const projectPath = `${cwd}/${projectName}`;

    // Remove generated dir - for dev only
    fs.rmdirSync(`${projectPath}`, { recursive: true });

    await mkdirp(`${projectPath}/server`);
    await mkdirp(`${projectPath}/server/config`);
    await mkdirp(`${projectPath}/server/controllers`);
    await mkdirp(`${projectPath}/server/middlewares`);
    await mkdirp(`${projectPath}/server/models`);

    createServerJsFile(projectPath);
    createDatabaseFile(projectPath);
    createPackageJsonFile(projectName, projectPath);

    models.forEach(model => {
      createModelFile(projectPath, database, model);
    });

    createAmConfigFile(projectPath, database, models);

    resolve();
  });
};

const createAmConfigFile = (projectPath, database, models) => {
  const cwd = process.cwd();
  const tplContent = fs.readFileSync(`${cwd}/app-template/server/config/adminmate.hbs`, 'utf8');
  const compiledTplContent = handlebars.compile(tplContent);
  const result = compiledTplContent({ models });

  createFile(`${projectPath}/server/config/adminmate.js`, result);
};

const createModelFile = (projectPath, database, model) => {
  const cwd = process.cwd();

  const databaseTemplates = {
    'mongodb': 'mongoose'
  };

  const tplContent = fs.readFileSync(`${cwd}/app-template/server/models/schema-${databaseTemplates[database]}.hbs`, 'utf8');
  const compiledTplContent = handlebars.compile(tplContent);
  const result = compiledTplContent({
    modelName: model.collection,
    jsonSchema: model.schema
  });

  createFile(`${projectPath}/server/models/${model.collection}.js`, result);
};

const createPackageJsonFile = (projectName, projectPath) => {
  const projectSlug = slugify(projectName);

  const packageJson = `
{
  "name": "${projectSlug}-adminmate-mongodb",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node ./server.js"
  },
  "dependencies": {
    "adminmate-express-mongoose": "^1.1.11",
    "axios": "^0.18.0",
    "cookie-parser": "^1.4.4",
    "cors": "^2.8.5",
    "express": "^4.16.4",
    "lodash": "^4.17.11",
    "moment": "^2.24.0",
    "mongoose": "^5.9.7",
    "promise": "^8.0.3"
  }
}`;

  createFile(`${projectPath}/package.json`, packageJson);
};

const createDatabaseFile = (projectPath) => {
  const cwd = process.cwd();

  fs.copyFileSync(`${cwd}/app-template/server/database-mongoose.js`, `${projectPath}/server/database.js`);
};

const createServerJsFile = (projectPath) => {
  const cwd = process.cwd();

  const serverJsContent = fs.readFileSync(`${cwd}/app-template/server.hbs`, 'utf8');
  const serverJsTemplate = handlebars.compile(serverJsContent);
  const result = serverJsTemplate({ database: 'mongodb' });

  createFile(`${projectPath}/server.js`, result);
};

const createFile = (filePath, content) => {
  if (fs.existsSync(filePath)) {
    console.log('This file already exist.')
    return;
  }

  fs.writeFileSync(filePath, content);
};