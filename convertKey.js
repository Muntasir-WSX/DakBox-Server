const fs= require ('fs'); 
const { buffer } = require('stream/consumers');
const key = fs.readFileSync('./dakbox-firebase-admin-key.json', 'utf-8');
const base64 = Buffer.from (key).toString('base64');
console.log(base64);