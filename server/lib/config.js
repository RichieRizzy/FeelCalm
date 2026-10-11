'use strict';
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, '..', '..', '.env')); } catch (e) { /* no .env file: use the real environment */ }
const env = process.env;
module.exports = {
  port: Number(env.PORT) || 3000,
  dataDir: env.DATA_DIR || path.join(__dirname, '..', '..', 'data'),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  jwtSecret: env.JWT_SECRET || '',
  paystackSecret: env.PAYSTACK_SECRET_KEY || '',
  paystackPublic: env.PAYSTACK_PUBLIC_KEY || '',
  country: (env.COUNTRY_CODE || 'ng').toLowerCase(),
  geofenceM: env.GEOFENCE_M !== undefined ? Number(env.GEOFENCE_M) : 400,
  tileLight: env.TILE_URL || 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  tileDark: env.TILE_URL_DARK || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  tileAttribution: env.TILE_ATTRIBUTION || '© OpenStreetMap contributors © CARTO',
  contact: env.CONTACT_EMAIL || 'support@feelcalm.app',
  testMode: !env.PAYSTACK_SECRET_KEY
};
