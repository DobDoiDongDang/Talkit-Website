import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  schema: './src/db/schema.ts', // Path to your Drizzle schema
  out: './drizzle',            // Output folder for migrations
  dialect: 'postgresql',       // Use PostgreSQL
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,                // Enable strict mode for migrations
  verbose: true,               // Enable verbose logging
});
