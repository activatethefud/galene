import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, waitFor, isVisible} from './harness.js';

// Mirrors galene.js storage keys.
const LOGIN_KEY = 'galene.login';
const USERNAME_KEY = 'galene.username';
const MEDIA_KEY = 'galene.media';

function storedLogin(window) {
    const raw = window.localStorage.getItem(LOGIN_KEY);
    if(!raw)
        return null;
    return JSON.parse(raw);
}

function sockets(window) {
    return window.__sockets || [];
}

/**
 * Drives one client WebSocket conversation through the protocol: open the
 * socket, reply to the client handshake, wait for the join message, then
 * answer it with the reply produced by `answer`.
 *
 * @param {Window} window
 * @param {object} socket
 * @param {(join: object) => object} answer
 */
async function driveConnection(window, socket, answer) {
    socket.serverOpen();
    await waitFor(
        () => socket.received.some((m) => m.type === 'handshake'),
        'client never sent its handshake');
    const handshake = socket.received.find((m) => m.type === 'handshake');
    socket.serverSend({type: 'handshake', version: ['2']});
    await waitFor(
        () => socket.received.some((m) => m.type === 'join'),
        'client never sent its join message');
    const join = socket.received.find((m) => m.type === 'join');
    socket.serverSend(answer(join));
    return {join, id: handshake.id};
}

const joinReply = (join, username) => ({
    type: 'joined',
    kind: 'join',
    group: join.group,
    username,
    permissions: ['message'],
    status: {},
    data: {},
});

function submitPasswordLogin(document, window, username, password) {
    document.getElementById('username').value = username;
    document.getElementById('password').value = password;
    const form = document.getElementById('loginform');
    form.dispatchEvent(new window.Event('submit', {cancelable: true}));
}

/**
 * Logs into the room with a plain username/password and waits until the
 * client has joined.  Returns the first socket's client id.
 */
async function joinRoom(app, username, password) {
    const w = app.window;
    submitPasswordLogin(app.document, w, username, password);
    await waitFor(
        () => sockets(w).length >= 1,
        'no join connection was made: ' + JSON.stringify(app.errors));
    const socket = sockets(w)[0];
    const {id} = await driveConnection(
        w, socket, (join) => joinReply(join, username));
    await waitFor(
        () => isVisible(app.document, 'login-container') === false,
        'the login screen was not dismissed after joining: ' +
            JSON.stringify(app.errors));
    return {socket, id};
}

function userAdd(id, username, data, streams) {
    return {
        type: 'user',
        kind: 'add',
        id,
        username,
        permissions: [],
        data: data || {},
        streams: streams || {},
    };
}

function chatFrom(id, username, value, kind) {
    return {
        type: 'chat',
        id: 'm-' + Math.random().toString(36).slice(2),
        source: id,
        dest: '',
        username,
        time: '2026-09-06T12:00:00.000Z',
        privileged: false,
        kind: kind || '',
        value,
    };
}

test('a password user joins the room and can log out again', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const w = app.window;
        const doc = app.document;
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown');

        const {id} = await joinRoom(app, 'alice', 'secret');

        assert.equal(doc.getElementById('userspan').textContent, 'alice',
            'the user\'s name should appear in the top bar');
        assert.notEqual(storedLogin(w), null);
        assert.equal(storedLogin(w).username, 'alice');
        assert.equal(storedLogin(w).password, 'secret');

        // The operator broadcasts our own user record on joining.
        const server = sockets(w)[0];
        server.serverSend(userAdd(id, 'alice'));
        await waitFor(
            () => !!doc.getElementById('user-' + id),
            'our own user row was not added');

        // Logging out clears the remembered password but keeps us on the
        // login screen.
        doc.getElementById('logoutbutton').click();
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown after logout: ' +
                JSON.stringify(app.errors));
        assert.equal(w.localStorage.getItem(LOGIN_KEY), null);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('incoming chat and chat history are rendered in the chat box', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const w = app.window;
        const doc = app.document;
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown');
        await joinRoom(app, 'alice', 'secret');

        const server = sockets(w)[0];
        // A regular chat message from another participant.
        server.serverSend(chatFrom('u2', 'Bob', 'hello alice'));
        await waitFor(
            () => doc.getElementById('box').textContent.includes('hello alice'),
            'incoming chat was not rendered: ' + JSON.stringify(app.errors));
        assert.ok(doc.getElementById('box').textContent.includes('Bob'));

        // An action (/me) message is rendered too.
        server.serverSend(chatFrom('u2', 'Bob', 'waves', 'me'));
        await waitFor(
            () => doc.getElementById('box').textContent.includes('waves'),
            '/me chat was not rendered: ' + JSON.stringify(app.errors));

        // Chat history uses the chathistory type but the same rendering.
        server.serverSend({
            type: 'chathistory',
            id: 'm-hist-1',
            source: 'u2',
            dest: '',
            username: 'Bob',
            time: '2026-09-06T11:59:00.000Z',
            privileged: false,
            kind: '',
            value: 'welcome to the room',
        });
        await waitFor(
            () => doc.getElementById('box').textContent.includes('welcome'),
            'chat history was not rendered: ' + JSON.stringify(app.errors));
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('typing in the chat input sends a chat message on the socket', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const w = app.window;
        const doc = app.document;
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown');
        const {id} = await joinRoom(app, 'alice', 'secret');

        const input = doc.getElementById('input');
        input.value = 'hello everyone';
        const form = doc.getElementById('inputform');
        form.dispatchEvent(new w.Event('submit', {cancelable: true}));

        const server = sockets(w)[0];
        await waitFor(
            () => server.received.some((m) => m.type === 'chat'),
            'no chat message was sent on the socket');
        const chat = server.received.find((m) => m.type === 'chat');
        assert.equal(chat.value, 'hello everyone');
        assert.equal(chat.kind, '');
        assert.equal(chat.username, 'alice');
        assert.equal(chat.source, id);

        // /me messages are sent with kind 'me'.
        input.value = '/me waves';
        form.dispatchEvent(new w.Event('submit', {cancelable: true}));
        await waitFor(
            () => server.received.some((m) => m.type === 'chat' && m.kind === 'me'),
            'no /me message was sent on the socket');
        assert.equal(
            server.received.find((m) => m.type === 'chat' && m.kind === 'me').value,
            'waves');
        assert.equal(input.value, '', 'the chat input should be cleared');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('participants are added, renamed and removed as the server reports them', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const w = app.window;
        const doc = app.document;
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown');
        const {id} = await joinRoom(app, 'alice', 'secret');
        const server = sockets(w)[0];

        // Our own row, then a remote participant.
        server.serverSend(userAdd(id, 'alice'));
        server.serverSend(userAdd('u2', 'Bob Smith'));
        await waitFor(
            () => !!doc.getElementById('user-u2'),
            'remote participant was not added: ' + JSON.stringify(app.errors));

        let bob = doc.getElementById('user-u2');
        assert.equal(bob.querySelector('.user-status-name').textContent,
            'Bob Smith');
        assert.equal(bob.querySelector('.user-avatar').textContent, 'BS',
            'the avatar should show the participant\'s initials');

        // The self row is kept first.
        const rows = doc.getElementById('users').children;
        assert.equal(rows[0].id, 'user-' + id,
            'our own row must be first in the participant list');

        // Renaming updates the row in place.
        server.serverSend({
            type: 'user', kind: 'change', id: 'u2',
            username: 'Robert',
            permissions: [], data: {}, streams: {},
        });
        await waitFor(
            () => {
                const elt = doc.getElementById('user-u2');
                return elt &&
                    elt.querySelector('.user-status-name').textContent === 'Robert';
            },
            'a rename did not update the row: ' + JSON.stringify(app.errors));
        assert.equal(
            doc.getElementById('user-u2').querySelector('.user-avatar').textContent,
            'R');

        // A raised hand is reflected on the row.
        server.serverSend({
            type: 'user', kind: 'change', id: 'u2',
            username: 'Robert',
            permissions: [],
            data: {raisehand: true},
            streams: {},
        });
        await waitFor(
            () => doc.getElementById('user-u2')
                .classList.contains('user-status-raisehand'),
            'the raised-hand badge was not shown');

        // Leaving removes the row again.
        server.serverSend({type: 'user', kind: 'delete', id: 'u2'});
        await waitFor(
            () => !doc.getElementById('user-u2'),
            'a leaving participant was not removed: ' +
                JSON.stringify(app.errors));
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('an operator mute mutes the local microphone and persists it', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const w = app.window;
        const doc = app.document;
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown');
        await joinRoom(app, 'alice', 'secret');

        const server = sockets(w)[0];
        server.serverSend({
            type: 'usermessage',
            source: 'op',
            dest: '',
            username: 'Operator',
            time: '2026-09-06T12:05:00.000Z',
            privileged: true,
            kind: 'mute',
            value: '',
        });

        await waitFor(
            () => {
                const settings = w.sessionStorage.getItem('settings');
                if(!settings)
                    return false;
                return JSON.parse(settings).localMute === true;
            },
            'the mute was not persisted to settings: ' +
                JSON.stringify(app.errors));

        const mutebutton = doc.getElementById('mutebutton');
        assert.ok(mutebutton.classList.contains('muted'),
            'the nav mute button should show the muted state');
        assert.ok(
            mutebutton.querySelector('span .fas')
                .classList.contains('fa-microphone-slash'),
            'the nav mute icon should be the crossed-out microphone');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('an unprivileged mute request is ignored', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const w = app.window;
        const doc = app.document;
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown');
        await joinRoom(app, 'alice', 'secret');

        const server = sockets(w)[0];
        server.serverSend({
            type: 'usermessage',
            source: 'u2',
            dest: '',
            username: 'Bob',
            time: '2026-09-06T12:05:00.000Z',
            privileged: false,
            kind: 'mute',
            value: '',
        });

        // Give any (incorrect) handling time to run, then verify the
        // microphone is untouched.
        await new Promise((resolve) => setTimeout(resolve, 100));
        const settings = w.sessionStorage.getItem('settings');
        const localMute = settings ? JSON.parse(settings).localMute : undefined;
        assert.equal(localMute, undefined,
            'an unprivileged mute must not persist localMute');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('a server disconnect returns the user to the login screen', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const w = app.window;
        const doc = app.document;
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown');
        await joinRoom(app, 'alice', 'secret');
        assert.equal(isVisible(doc, 'login-container'), false);

        // The server drops the connection (e.g. the user was kicked or the
        // network dropped).  The client must return to the login screen.
        const server = sockets(w)[0];
        server.close(1006, 'abnormal closure');
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'the login screen was not shown after the server closed the ' +
                'connection: ' + JSON.stringify(app.errors));
        assert.equal(doc.getElementById('username').value, 'alice',
            'the username should be remembered');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('remote tile labels fall back to the participant registry', async () => {
    const app = await loadApp({webSocket: true});
    try {
        const w = app.window;
        const doc = app.document;
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown');
        await joinRoom(app, 'alice', 'secret');

        // The server tells us about another participant (the publisher of a
        // down stream) whose offer may carry no username.
        const server = sockets(w)[0];
        server.serverSend(userAdd('u2', 'Bob Smith'));
        await waitFor(
            () => doc.getElementById('user-u2') !== null,
            'the remote user row did not appear');

        // A down stream whose offer arrived without a username should still
        // be named from the participant registry (serverConnection.users),
        // exactly as a camera-on or camera-off remote tile would be.
        let label = doc.createElement('div');
        label.id = 'label-d';
        doc.body.appendChild(label);
        w.setLabel({localId: 'd', username: '', up: false, source: 'u2'});
        assert.equal(label.textContent, 'Bob Smith');
        assert.equal(label.dataset.name, 'Bob Smith');
        doc.body.removeChild(label);

        // Same for the avatar text shown on a camera-off tile.
        let avatar = doc.createElement('div');
        avatar.innerHTML = '<span class="avatar-initials"></span>';
        doc.body.appendChild(avatar);
        w.setAvatarText(avatar, {username: '', up: false, source: 'u2'});
        assert.equal(avatar.querySelector('.avatar-initials').textContent,
                     'Bob Smith');
        doc.body.removeChild(avatar);

        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});
