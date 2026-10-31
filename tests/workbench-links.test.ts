import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkbenchLinks} from '../src/server/workbench-links';

const token=(url:string)=>new URLSearchParams(new URL(url).hash.slice(1)).get('ticket')!;
test('both returned links authorize the exact project across browser opens',()=>{
  const links=new WorkbenchLinks(),a=links.issue('http://127.0.0.1:4325','project_a'),b=links.issue('http://127.0.0.1:4325','project_b');
  assert.equal(a.url,a.workspaceUrl);assert.equal(new URL(a.url).searchParams.get('project'),'project_a');
  assert.match(token(a.url),/^[a-f0-9]{48}$/);assert.notEqual(token(a.url),token(b.url));
  for(let i=0;i<3;i++)assert.equal(links.projectFor(token(a.url)),'project_a');
  assert.equal(links.projectFor(token(b.url)),'project_b');assert.equal(links.projectFor('project_a'),undefined);assert.equal(links.projectFor(''),undefined);
});
test('repeated use cannot extend the ten minute deadline; newly issued links remain independent',()=>{
  let now=1000;const links=new WorkbenchLinks(()=>now),a=links.issue('http://127.0.0.1:4325','project_a');
  now+=599999;assert.equal(links.projectFor(token(a.url)),'project_a');
  const b=links.issue('http://127.0.0.1:4325','project_b');now++;
  assert.equal(links.projectFor(token(a.url)),undefined);assert.equal(links.projectFor(token(b.url)),'project_b');
  now+=600000;assert.equal(links.projectFor(token(b.url)),undefined);
});
test('service restart does not preserve launch credentials',()=>{
  const first=new WorkbenchLinks(),a=first.issue('http://127.0.0.1:4325','project_a');
  assert.equal(new WorkbenchLinks().projectFor(token(a.url)),undefined);
});
