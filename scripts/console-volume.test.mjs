import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { violations, watchConsole } from '../tests/console/observer.mjs';

const origin = 'http://127.0.0.1:8096';
function emit(page, type, asset = 'main.tesserafin.bundle.js') {
    page.emit('console', {
        type: () => type,
        location: () => ({ url: asset ? `${origin}/web/${asset}?v=123` : '' }),
        text: () => {
            throw new Error('the observer must not read payloads');
        }
    });
}

test('per-flow first-party ceilings catch even debug-only regressions', () => {
    const page = new EventEmitter();
    const first = watchConsole(page, origin);
    emit(page, 'log');
    emit(page, 'debug', '732.abcd.chunk.js');
    const report = first.finish();
    assert.deepEqual(violations(report, 2), []);
    assert.deepEqual(violations(report, 1), ['firstParty: volume 2 > 1']);
    const second = watchConsole(page, origin);
    assert.deepEqual(violations(second.finish(), 0), []);
    assert.equal(page.listenerCount('console'), 0);
    assert.equal(page.listenerCount('pageerror'), 0);
});

test('dependency output is separately counted; dependency warnings/errors fail', () => {
    for (const level of ['warning', 'error']) {
        const page = new EventEmitter();
        const observer = watchConsole(page, origin);
        emit(page, 'log', 'node_modules.jellyfin-apiclient.bundle.js');
        emit(page, level, 'node_modules.hls.js.abc.chunk.js');
        const report = observer.finish();
        assert.equal(report.dependency.log, 1);
        assert.equal(report.dependency[level], 1);
        assert.deepEqual(violations(report, 0), ['dependency: warning/error']);
    }
});

test('first-party warnings/errors and unattributed emissions cannot pass', () => {
    const page = new EventEmitter();
    const observer = watchConsole(page, origin);
    emit(page, 'warning');
    emit(page, 'error');
    emit(page, 'debug', '');
    page.emit('pageerror', new Error('not persisted'));
    assert.deepEqual(violations(observer.finish(), 0), [
        'firstParty: warning/error',
        'unattributed output',
        'uncaught page error'
    ]);
});
