import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from '../src/index.js';

await migrate(getDb(), { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
await closeDb();
console.log('Migrações aplicadas.');
