import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    loadApp, waitFor, isVisible, joinRoom, submitChat, userMessage,
} from './harness.js';

function sent(socket, type) {
    return socket.received.filter((m) => m.type === type);
}

function last(socket, type) {
    const ms = sent(socket, type);
    assert.ok(ms.length > 0, `expected a ${type} message`);
    return ms[ms.length - 1];
}

async function joinedApp(opts = {}) {
    const app = await loadApp({webSocket: true, ...opts});
    const room = await joinRoom(app, {username: 'alice', password: 'x'});
    return {app, socket: room.socket};
}

test('the logout button is hidden on the login screen and visible in the room', async () => {
    const app = await loadApp({webSocket: true});
    try {
        assert.equal(isVisible(app.document, 'logoutbutton'), false);
    } finally {
        app.close();
    }
});

test('the logout button becomes visible once the user is in the room', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const room = await joinRoom(app, {username: 'alice', password: 'x'});
        assert.ok(room.socket);
        await waitFor(
            () => isVisible(app.document, 'logoutbutton'),
            'expected the logout button to appear in the room');
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});

test('the in-room mute and camera nav buttons are hidden without present permission', async () => {
    const app = await loadApp({webSocket: true});
    try {
        await joinRoom(app, {username: 'alice', password: 'x'});
        await waitFor(
            () => isVisible(app.document, 'logoutbutton'),
            'expected to be in the room');
        assert.equal(isVisible(app.document, 'mutebutton'), false);
        assert.equal(isVisible(app.document, 'cambutton'), false);
        assert.equal(isVisible(app.document, 'sharebutton'), false);
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});

test('the air indicator appears while in the room with media on', async () => {
    const app = await loadApp({webSocket: true});
    try {
        await joinRoom(app, {username: 'alice', password: 'x'});
        await waitFor(
            () => isVisible(app.document, 'air-indicator'),
            'expected the air indicator while in the room');
        const text = app.document.querySelector('#air-indicator .air-indicator-text');
        assert.ok(text);
        assert.match(text.textContent, /(Mic and camera are on|Microphone is on|Camera is on)/);
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});

test('the air indicator is hidden on the login screen', async () => {
    const app = await loadApp({webSocket: true});
    try {
        assert.equal(isVisible(app.document, 'air-indicator'), false);
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});

test('the username span shows the joined user name', async () => {
    const app = await loadApp({webSocket: true});
    try {
        await joinRoom(app, {username: 'alice', password: 'x'});
        await waitFor(
            () => app.document.getElementById('userspan') &&
                app.document.getElementById('userspan').textContent === 'alice',
            'expected the username span to show alice');
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});

test('a renamed participant updates their row and initials', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const room = await joinRoom(app, {username: 'alice', password: 'x'});
        room.socket.serverSend(
            userMessage('user', 'add', 'u2', 'Bob Smith', {}, {}));
        await waitFor(
            () => app.document.getElementById('user-u2') !== null,
            'expected the user row to appear');
        room.socket.serverSend(
            userMessage('user', 'change', 'u2', 'Robert Lee', {}, {})),
        await waitFor(
            () => app.document.getElementById('user-u2') &&
                app.document.getElementById('user-u2')
                    .querySelector('.user-status-name').textContent === 'Robert Lee',
            'expected the renamed user row');
        const avatar = app.document.getElementById('user-u2').querySelector('.user-avatar');
        assert.equal(avatar.textContent, 'RL');
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});

test('an operator can lock and unlock the group', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const room = await joinRoom(app, {username: 'op', password: 'x'});
        // Upgrade to operator mid-session, then use /lock and /unlock.
        room.socket.serverSend({
            type: 'joined', kind: 'change', group: 'group1', username: 'op',
            permissions: ['message', 'op'], status: {}, data: {},
        });
        await waitFor(() => {
            const p = app.document.getElementById('permspan');
            return p && p.textContent !== '';
        }, 'expected operator permissions to be applied');
        submitChat(app.document, app.window, '/lock classroom');
        await waitFor(
            () => sent(room.socket, 'groupaction').length >= 1,
            'expected a groupaction lock');
        const lock = last(room.socket, 'groupaction');
        assert.equal(lock.kind, 'lock');
        submitChat(app.document, app.window, '/unlock');
        await waitFor(
            () => sent(room.socket, 'groupaction').length >= 2,
            'expected a groupaction unlock');
        const unlock = last(room.socket, 'groupaction');
        assert.equal(unlock.kind, 'unlock');
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});

test('a user without record permission is refused /record', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const room = await joinRoom(app, {username: 'alice', password: 'x'});
        submitChat(app.document, app.window, '/record');
        await waitFor(
            () => app.document.body.textContent.includes('You are not allowed to record'),
            'expected the record rejection toast');
        assert.equal(sent(room.socket, 'groupaction').length, 0);
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});

test('a non-operator is refused /subgroups', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const room = await joinRoom(app, {username: 'alice', password: 'x'});
        submitChat(app.document, app.window, '/subgroups');
        await waitFor(
            () => app.document.body.textContent.includes('You are not an operator'),
            'expected the operator rejection toast');
        assert.equal(sent(room.socket, 'groupaction').length, 0);
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});

test('the /msg command echoes a private message row locally', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const room = await joinRoom(app, {username: 'alice', password: 'x'});
        room.socket.serverSend(
            userMessage('user', 'add', 'u2', 'Bob', {}, {}));
        await waitFor(
            () => app.document.getElementById('user-u2') !== null,
            'expected the user row to appear');
        submitChat(app.document, app.window, '/msg Bob a secret');
        await waitFor(
            () => app.document.getElementById('box').textContent.includes('a secret'),
            'expected the private message echo');
        const rows = app.document.querySelectorAll('#box .message-row .message');
        assert.ok(rows.length > 0);
        assert.equal(app.errors.length, 0);
    } finally {
        app.close();
    }
});
