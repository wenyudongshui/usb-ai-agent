// app/modules/crypto.js
// AES-256-GCM encrypt/decrypt + scrypt KEK derivation (node:crypto, zero deps).
'use strict';

const crypto = require('crypto');

const KDF = { N: 32768, r: 8, p: 1 };   // scrypt N=2^15

function randomKey(len) {
  return crypto.randomBytes(len);
}

// deriveKEK(password, salt) -> 32-byte Buffer (scrypt)
function deriveKEK(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p });
}

// encrypt(plainObj, key) -> { iv, tag, data }  (base64 strings)
function encrypt(plainObj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plainObj), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

// decrypt({iv,tag,data}, key) -> plainObj (throws on wrong key / tamper)
function decrypt(blob, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const data = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]);
  return JSON.parse(data.toString('utf8'));
}

module.exports = { KDF, randomKey, deriveKEK, encrypt, decrypt };