/**
 * Start wrapper: ensure DB_CLIENT defaults to sqlite so `npm start` works
 * without requiring the user to set environment variables manually.
 */
// Fuseau officiel de l'application : Kinshasa (UTC+1).
// Doit etre defini avant toute creation de date ou de connexion DB.
if (!process.env.TZ) process.env.TZ = 'Africa/Kinshasa';
require('dotenv').config();
if (!process.env.DB_CLIENT) process.env.DB_CLIENT = 'sqlite';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'ecolepay-secret';
// allow overriding via existing env vars
require('./server');
