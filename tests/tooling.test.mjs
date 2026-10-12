import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('vendored shadcn stylesheet preserves upstream bytes and its MIT license',()=>{
  const css=readFileSync('app/vendor/shadcn-tailwind.css','utf8');
  assert.match(css.split('\n')[0],/shadcn 4\.18\.0.*MIT/);
  assert.equal(createHash('sha256').update(css.split('\n').slice(1).join('\n')).digest('hex'),'bc7d83425702955b4cb67cb14ede9d603f9d912376d57a2d81d661094d2a782a');
  const license=readFileSync('app/vendor/SHADCN-LICENSE.txt','utf8');
  assert.match(license,/Copyright \(c\) 2023 shadcn/);assert.match(license,/Permission is hereby granted/);
  assert.match(readFileSync('app/globals.css','utf8'),/@import '\.\/vendor\/shadcn-tailwind\.css'/);
});

test('development tool lock retains patched workers and excludes the unused shadcn CLI',()=>{
  const manifest=JSON.parse(readFileSync('package.json','utf8')),lock=JSON.parse(readFileSync('package-lock.json','utf8'));
  assert.equal(manifest.devDependencies.shadcn,undefined);
  for(const [path,entry]of Object.entries(lock.packages)) {
    assert.ok(!path.endsWith('/shadcn')&&!path.endsWith('/braces'),path);
    if(path.endsWith('/tinypool')){
      const [major,minor,patch]=entry.version.split('.').map(Number);
      assert.ok(major>2||major===2&&(minor>1||minor===1&&patch>=2),entry.version);
    }
    if(path.endsWith('/esbuild'))assert.ok(Number(entry.version.split('.')[0])>0||Number(entry.version.split('.')[1])>=25,entry.version);
  }
  assert.deepEqual(lock.packages[''].dependencies,manifest.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies,manifest.devDependencies);
});
