/**
 * Start wrapper: ensure DB_CLIENT defaults to sqlite so `npm start` works
 * without requiring the user to set environment variables manually.
 */
require('dotenv').config();
if (!process.env.DB_CLIENT) process.env.DB_CLIENT = 'sqlite';
// allow overriding via existing env vars
require('./server');
