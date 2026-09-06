import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    loadApp, waitFor, isVisible, joinRoom, submitChat,
    userMessage, driveConnection, joinReply, sockets, hasClass,
} from './harness.js';

function sent(socket, type) {
    return (socket.received || []).filter((m) => m.type === type);
}

async function lastOf(socket, type, message) {
    await waitFor(
        () => sent(socket, type).length > 0,
        message || `expected the client to send a ${type} message`);
    const list = sent(socket, type);
    return list[list.length - 1];
}

test('a plain chat message is sent to the server', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'alice', password: 'secret'});
        submitChat(app.document, app.window, 'hello everyone');
        const m = await lastOf(socket, 'chat');
        assert.equal(m.value, 'hello everyone');
        assert.equal(m.kind, '');
        assert.equal(m.username, 'alice');
        assert.equal(m.dest, '');
        assert.equal(app.document.getElementById('input').value, '');
    } finally {
        app.close();
    }
});

test('the /me command is sent with kind me', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'alice', password: 'secret'});
        submitChat(app.document, app.window, '/me waves hello');
        const m = await lastOf(socket, 'chat');
        assert.equal(m.value, 'waves hello');
        assert.equal(m.kind, 'me');
    } finally {
        app.close();
    }
});

test('a leading double slash sends the message verbatim', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'alice', password: 'secret'});
        submitChat(app.document, app.window, '//not a command');
        const m = await lastOf(socket, 'chat');
        assert.equal(m.value, '/not a command');
        assert.equal(m.kind, '');
    } finally {
        app.close();
    }
});

test('an unknown command shows an error and sends nothing', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'alice', password: 'secret'});
        const before = sent(socket, 'chat').length;
        submitChat(app.document, app.window, '/bogus-command xyz');
        await waitFor(
            () => app.document.body.textContent.includes('Unknown command'),
            'expected an unknown-command toast');
        assert.equal(sent(socket, 'chat').length, before);
        assert.ok(
            app.document.querySelector('.toastify.on.error') !== null,
            'expected an error toast for the unknown command');
    } finally {
        app.close();
    }
});

test('the /help command prints local help in the chat box', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'alice', password: 'secret'});
        submitChat(app.document, app.window, '/help');
        await waitFor(
            () => app.document.getElementById('box').textContent.includes('/leave'),
            'expected the help text to be shown in the chat box');
        assert.equal(sent(socket, 'chat').length, 0);
    } finally {
        app.close();
    }
});

test('the /leave command closes the connection', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        await joinRoom(app, {username: 'alice', password: 'secret'});
        submitChat(app.document, app.window, '/leave');
        await waitFor(
            () => isVisible(app.document, 'login-container'),
            'expected to return to the login screen after /leave');
    } finally {
        app.close();
    }
});

test('the /msg command sends a chat targeted at a user id', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket, id} = await joinRoom(app, {username: 'alice', password: 'secret'});
        socket.serverSend(userMessage('user', 'add', 'u2', 'Bob', {}, {
            'bobs-stream': {audio: {}},
        }));
        await waitFor(
            () => app.document.getElementById('user-u2') !== null,
            'expected the remote user row to appear');
        submitChat(app.document, app.window, '/msg Bob psst');
        const m = await lastOf(socket, 'chat');
        assert.equal(m.dest, 'u2');
        assert.equal(m.value, 'psst');
    } finally {
        app.close();
    }
});

test('the /raise and /unraise commands set and clear the raisehand flag', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket, id} = await joinRoom(app, {username: 'alice', password: 'secret'});
        submitChat(app.document, app.window, '/raise');
        let ua = await lastOf(socket, 'useraction');
        assert.equal(ua.kind, 'setdata');
        assert.equal(ua.dest, id);
        assert.equal(ua.value.raisehand, true);
        submitChat(app.document, app.window, '/unraise');
        await waitFor(
            () => sent(socket, 'useraction').length >= 2,
            'expected a second useraction');
        const all = sent(socket, 'useraction');
        ua = all[all.length - 1];
        assert.equal(ua.value.raisehand, null);
    } finally {
        app.close();
    }
});

test('the /set command stores a setting locally', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'alice', password: 'secret'});
        submitChat(app.document, app.window, '/set mirrorView false');
        await waitFor(
            () => JSON.parse(app.window.sessionStorage.getItem('settings')).mirrorView === false,
            'expected mirrorView to be stored');
        assert.equal(sent(socket, 'chat').length, 0);
    } finally {
        app.close();
    }
});

test('the /unset command removes a setting', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        await joinRoom(app, {username: 'alice', password: 'secret'});
        app.window.sessionStorage.setItem('settings', JSON.stringify({mirrorView: false}));
        submitChat(app.document, app.window, '/unset mirrorView');
        await waitFor(
            () => {
                const raw = app.window.sessionStorage.getItem('settings');
                const parsed = JSON.parse(raw);
                return parsed.mirrorView === undefined;
            },
            'expected mirrorView to be removed');
    } finally {
        app.close();
    }
});

test('an operator can /clear the chat with a group action', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'op', password: 'admin'});
        // grant op to make the predicate pass
        socket.serverSend({
            type: 'joined', kind: 'change', group: 'group1', username: 'op',
            permissions: ['message', 'op'], status: {}, data: {},
        });
        await waitFor(
            () => (socket.received || []).length > 0, 'waiting for change');
        submitChat(app.document, app.window, '/clear');
        const ga = await lastOf(socket, 'groupaction');
        assert.equal(ga.kind, 'clearchat');
    } finally {
        app.close();
    }
});

test('a non-operator is refused the /clear command', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'alice', password: 'secret'});
        submitChat(app.document, app.window, '/clear');
        await waitFor(
            () => app.document.body.textContent.includes('You are not an operator'),
            'expected the operator-only rejection toast');
        assert.equal(sent(socket, 'groupaction').length, 0);
    } finally {
        app.close();
    }
});

test('an operator /mute sends a user message to the target', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'op', password: 'admin'});
        socket.serverSend({
            type: 'joined', kind: 'change', group: 'group1', username: 'op',
            permissions: ['message', 'op'], status: {}, data: {},
        });
        await waitFor(() => sent(socket, 'groupaction').length >= 0);
        socket.serverSend(userMessage('user', 'add', 'u2', 'Bob', {}, {
            'bobs-stream': {audio: {}},
        }));
        await waitFor(
            () => app.document.getElementById('user-u2') !== null,
            'expected the remote user row to appear');
        submitChat(app.document, app.window, '/mute u2');
        const um = await lastOf(socket, 'usermessage');
        assert.equal(um.kind, 'mute');
        assert.equal(um.dest, 'u2');
    } finally {
        app.close();
    }
});

test('the /warn command sends a warning user message', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'op', password: 'admin'});
        socket.serverSend({
            type: 'joined', kind: 'change', group: 'group1', username: 'op',
            permissions: ['message', 'op'], status: {}, data: {},
        });
        socket.serverSend(userMessage('user', 'add', 'u2', 'Bob', {}, {
            'bobs-stream': {audio: {}},
        }));
        await waitFor(
            () => app.document.getElementById('user-u2') !== null,
            'expected the remote user row to appear');
        submitChat(app.document, app.window, '/warn u2 behave');
        const um = await lastOf(socket, 'usermessage');
        assert.equal(um.kind, 'warning');
        assert.equal(um.dest, 'u2');
        assert.equal(um.value, 'behave');
    } finally {
        app.close();
    }
});

test('an operator /kick sends a kick user action', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'op', password: 'admin'});
        socket.serverSend({
            type: 'joined', kind: 'change', group: 'group1', username: 'op',
            permissions: ['message', 'op'], status: {}, data: {},
        });
        socket.serverSend(userMessage('user', 'add', 'u2', 'Bob', {}, {
            'bobs-stream': {audio: {}},
        }));
        await waitFor(
            () => app.document.getElementById('user-u2') !== null,
            'expected the remote user row to appear');
        submitChat(app.document, app.window, '/kick u2');
        const ua = await lastOf(socket, 'useraction');
        assert.equal(ua.kind, 'kick');
        assert.equal(ua.dest, 'u2');
    } finally {
        app.close();
    }
});

test('a user with the token permission can /invite a token', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'alice', password: 'secret'});
        socket.serverSend({
            type: 'joined', kind: 'change', group: 'group1', username: 'alice',
            permissions: ['message', 'token'], status: {}, data: {},
        });
        submitChat(app.document, app.window, '/invite bob');
        const ga = await lastOf(socket, 'groupaction');
        assert.equal(ga.kind, 'maketoken');
        assert.equal(ga.value.username, 'bob');
        assert.ok(ga.value.expires !== undefined, 'an expiry should be set');
    } finally {
        app.close();
    }
});

test('a user without the token permission cannot /invite', async () => {
    const app = await loadApp({webSocket: true, waitLogin: false});
    try {
        const {socket} = await joinRoom(app, {username: 'alice', password: 'secret'});
        submitChat(app.document, app.window, '/invite bob');
        await waitFor(
            () => app.document.body.textContent.includes(
                "You don't have permission to create tokens"),
            'expected the permission rejection toast');
        assert.equal(sent(socket, 'groupaction').length, 0);
    } finally {
        app.close();
    }
});

test('typing into the chat box while disconnected reports Not connected', async () => {
    const app = await loadApp({webSocket: false});
    try {
        submitChat(app.document, app.window, 'hello');
        await waitFor(
            () => app.document.body.textContent.includes('Not connected'),
            'expected a Not connected message');
    } finally {
        app.close();
    }
});
