import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    loadApp,
    waitFor,
    joinRoom,
} from './harness.js';

test('parseToken extracts a token from an http link', async () => {
    const app = await loadApp({});
    const w = app.window;
    assert.equal(w.parseToken('https://classroom.zoho.to/group/test/?token=abc123'), 'abc123');
    assert.equal(w.parseToken('https://classroom.zoho.to/group/test/?token=a.b-c_9&x=1'), 'a.b-c_9&x=1');
    assert.equal(w.parseToken('raw-token-xyz'), 'raw-token-xyz');
    assert.throws(() => w.parseToken('https://classroom.zoho.to/group/test/'), /Couldn't parse link/);
    assert.deepEqual(app.errors, []);
    app.close();
});

test('an operator receiving a token message prints the invitation link', async () => {
    const app = await loadApp({ webSocket: true });
    const { socket } = await joinRoom(app, { username: 'op', password: 'x' });
    socket.serverSend({
        type: 'usermessage',
        source: 'server',
        username: 'server',
        time: '2026-09-06T12:00:00.000Z',
        privileged: true,
        kind: 'token',
        value: { token: 'abc123', group: 'group1', expires: Date.now() + 86400000 },
    });
    await waitFor(() => {
        const box = app.document.getElementById('box');
        return !!box && box.textContent.includes('Invitation') &&
            box.textContent.includes('token=abc123');
    }, 'expected the invitation link to be printed');
    const box = app.document.getElementById('box');
    assert.ok(box.textContent.includes('to group group1'));
    assert.deepEqual(app.errors, []);
    app.close();
});

test('a tokenlist message prints every listed invitation', async () => {
    const app = await loadApp({ webSocket: true });
    const { socket } = await joinRoom(app, { username: 'op', password: 'x' });
    socket.serverSend({
        type: 'usermessage',
        source: 'server',
        username: 'server',
        time: '2026-09-06T12:00:00.000Z',
        privileged: true,
        kind: 'tokenlist',
        value: [
            { token: 'one', group: 'group1', username: 'bob', expires: Date.now() + 86400000 },
            { token: 'two', group: 'group1', expires: Date.now() + 86400000 },
        ],
    });
    await waitFor(() => {
        const box = app.document.getElementById('box');
        return !!box && box.textContent.includes('token=one') &&
            box.textContent.includes('token=two');
    }, 'expected both invitation links');
    const box = app.document.getElementById('box');
    assert.ok(box.textContent.includes('for user bob'));
    assert.ok(box.textContent.includes('Invitation'));
    assert.deepEqual(app.errors, []);
    app.close();
});

test('an expired token message is reported as expired', async () => {
    const app = await loadApp({ webSocket: true });
    const { socket } = await joinRoom(app, { username: 'op', password: 'x' });
    socket.serverSend({
        type: 'usermessage',
        source: 'server',
        username: 'server',
        time: '2026-09-06T12:00:00.000Z',
        privileged: true,
        kind: 'token',
        value: { token: 'dead', group: 'group1', expires: Date.now() - 1000 },
    });
    await waitFor(() => {
        const box = app.document.getElementById('box');
        return !!box && box.textContent.includes('Expired invitation');
    }, 'expected the expired invitation to be flagged');
    assert.deepEqual(app.errors, []);
    app.close();
});

test('an unprivileged token message is ignored', async () => {
    const app = await loadApp({ webSocket: true });
    const { socket } = await joinRoom(app, { username: 'op', password: 'x' });
    socket.serverSend({
        type: 'usermessage',
        source: 'server',
        username: 'server',
        time: '2026-09-06T12:00:00.000Z',
        privileged: false,
        kind: 'token',
        value: { token: 'sneaky', group: 'group1' },
    });
    await new Promise((r) => setTimeout(r, 100));
    const box = app.document.getElementById('box');
    assert.ok(!box.textContent.includes('token=sneaky'));
    assert.deepEqual(app.errors, []);
    app.close();
});

test('a userinfo message describes the remote user', async () => {
    const app = await loadApp({ webSocket: true });
    const { socket } = await joinRoom(app, { username: 'alice', password: 'x' });
    socket.serverSend({
        type: 'usermessage',
        source: 'server',
        username: 'server',
        time: '2026-09-06T12:00:00.000Z',
        privileged: true,
        kind: 'userinfo',
        value: { id: 'u2', username: 'Bob', address: '1.2.3.4' },
    });
    await waitFor(() => {
        const box = app.document.getElementById('box');
        return !!box && box.textContent.includes('u2');
    }, 'expected the userinfo message to be printed');
    const box = app.document.getElementById('box');
    assert.ok(box.textContent.includes('Bob'));
    assert.ok(box.textContent.includes('1.2.3.4'));
    assert.deepEqual(app.errors, []);
    app.close();
});

test('inviteMenu warns when modal dialogs are unsupported', async () => {
    // jsdom has no HTMLDialogElement.prototype.showModal, so inviteMenu()
    // must surface the dedicated error instead of throwing.
    const app = await loadApp({ webSocket: true });
    await joinRoom(app, { username: 'op', password: 'x' });
    app.window.inviteMenu();
    await waitFor(() => app.document.body.textContent.includes("doesn't support modal dialogs"),
        'expected the modal-dialog warning toast');
    assert.deepEqual(app.errors, []);
    app.close();
});
