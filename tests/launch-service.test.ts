import test from 'node:test';
import assert from 'node:assert/strict';
import {windowsArgument} from '../src/server/launch-service';

test('Windows argv quoting preserves spaces, Unicode, shell metacharacters and trailing slashes',()=>{
  assert.equal(windowsArgument(''), '""');
  assert.equal(windowsArgument('C:\\视频 & $()\\app'), '"C:\\视频 & $()\\app"');
  assert.equal(windowsArgument('C:\\folder\\'), '"C:\\folder\\\\"');
  assert.equal(windowsArgument('say "yes"'), '"say \\"yes\\""');
  assert.throws(()=>windowsArgument('bad\0argument'));
});
