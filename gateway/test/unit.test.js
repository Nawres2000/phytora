import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordError } from '../src/utils/validate.js';
import { sniffImage } from '../src/utils/image.js';
import { catalogList, describeClass, isClass } from '../src/utils/catalog.js';

test('password policy', () => {
  assert.match(passwordError('short1A!'.slice(0, 5)), /8 caractères/);
  assert.match(passwordError('alllowercase1!'), /majuscule/);
  assert.match(passwordError('ALLUPPERCASE1!'), /minuscule/);
  assert.match(passwordError('NoDigitsHere!'), /chiffre/);
  assert.match(passwordError('NoSpecial123'), /spécial/);
  assert.equal(passwordError('Str0ng!Passw0rd'), null);
  assert.match(passwordError('Aa1!' + 'x'.repeat(80)), /72/);
});

test('image sniffing uses the real bytes, not the claimed type', () => {
  const pad = Buffer.alloc(16);
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad])), 'image/jpeg');
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad])), 'image/png');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad])), 'image/webp');
  assert.equal(sniffImage(Buffer.from('<?php echo 1; ?> pretend this is a jpg')), null);
  assert.equal(sniffImage(Buffer.alloc(3)), null);
});

test('catalog covers the 38 model classes with complete French content', () => {
  const list = catalogList();
  assert.equal(list.length, 38);
  for (const c of list) for (const k of ['plant', 'disease', 'symptoms', 'prevention']) assert.ok(c[k], `${c.id} missing ${k}`);
  assert.equal(list.filter((c) => c.healthy).length, 12);
  assert.ok(isClass('Tomato___Late_blight'));
  assert.ok(!isClass('__proto__'));
  assert.deepEqual(describeClass('Tomato___Late_blight'), { class_id: 'Tomato___Late_blight', plant_species: 'Tomate', disease: 'Mildiou (Late blight)', is_healthy: false });
  assert.equal(describeClass('Rose___Black_spot').plant_species, 'Rose'); // unknown class falls back to the raw id
});
