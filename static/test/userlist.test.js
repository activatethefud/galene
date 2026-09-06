import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './harness.js';

function makeUserinfo(overrides) {
    return Object.assign({
        username: 'Alice Smith',
        data: {},
        streams: {},
    }, overrides);
}

function rowWithStatus(win, userinfo) {
    let elt = win.document.createElement('div');
    elt.id = 'user-test';
    elt.className = 'user-p';
    win.setUserStatus('test', elt, userinfo);
    return elt;
}

test('a participant row shows initials, name and muted mic/camera-off icons', async (t) => {
    let app = await loadApp({});
    t.after(() => app.close());
    let win = app.window;

    // camera + audio, not muted => green mic + camera on
    let elt = rowWithStatus(win, makeUserinfo({
        username: 'Alice Smith',
        streams: {foo: {audio: 'audio', video: 'video'}},
    }));
    assert.equal(elt.querySelector('.user-avatar').textContent, 'AS');
    assert.equal(elt.querySelector('.user-status-name').textContent,
                 'Alice Smith');
    let icons = elt.querySelector('.user-status-icons');
    assert.ok(icons.querySelector('.fa-microphone'));
    assert.ok(!icons.querySelector('.fa-microphone-slash'));
    assert.ok(icons.querySelector('.fa-video'));
    assert.ok(!icons.querySelector('.fa-video-slash'));

    // muted audio => red crossed-out mic, camera still on
    let muted = rowWithStatus(win, makeUserinfo({
        username: 'Bob',
        data: {muted: true},
        streams: {foo: {audio: 'audio', video: 'video'}},
    }));
    let mic = muted.querySelector('.fa-microphone-slash');
    assert.ok(mic);
    assert.ok(mic.classList.contains('user-status-off'));
    assert.ok(muted.querySelector('.fa-video'));
    assert.equal(muted.querySelector('.user-avatar').textContent, 'B');

    // anonymous: no username, no streams => '(anon)', '?' avatar, both off
    let anon = rowWithStatus(win, makeUserinfo({username: null}));
    assert.equal(anon.querySelector('.user-status-name').textContent,
                 '(anon)');
    assert.equal(anon.querySelector('.user-avatar').textContent, '?');
    assert.ok(anon.querySelector('.fa-microphone-slash'));
    assert.ok(anon.querySelector('.fa-video-slash'));
});

test('single-word and anonymous names produce correct initials', async (t) => {
    let app = await loadApp({});
    t.after(() => app.close());
    let win = app.window;
    assert.equal(win.getInitials('ada'), 'A');
    assert.equal(win.getInitials('Ada Lovelace'), 'AL');
    assert.equal(win.getInitials('  many   spaced  words  '), 'MS');
    assert.equal(win.getInitials(''), '?');
    assert.equal(win.getInitials(null), '?');
});

test('raisehand adds the badge class to the row', async (t) => {
    let app = await loadApp({});
    t.after(() => app.close());
    let win = app.window;

    let raised = rowWithStatus(win, makeUserinfo({
        username: 'Carol',
        data: {raisehand: true},
    }));
    assert.ok(raised.classList.contains('user-status-raisehand'));

    let normal = rowWithStatus(win, makeUserinfo({username: 'Carol'}));
    assert.ok(!normal.classList.contains('user-status-raisehand'));
});

test('the tile avatar shows the full username, the lobby keeps initials', async (t) => {
    let app = await loadApp({});
    t.after(() => app.close());
    let win = app.window;

    // Big canvas tile: full display name.
    let tile = win.document.createElement('div');
    tile.innerHTML = '<span class="avatar-initials"></span>';
    win.setAvatarText(tile, {username: 'Ada Lovelace', up: true});
    assert.equal(tile.querySelector('.avatar-initials').textContent,
                 'Ada Lovelace');
    assert.ok(!tile.querySelector('.avatar-initials').classList
                  .contains('avatar-long'));

    // Long names get the smaller-font class.
    let long = win.document.createElement('div');
    long.innerHTML = '<span class="avatar-initials"></span>';
    win.setAvatarText(long,
                      {username: 'A Very Long Username Indeed', up: true});
    assert.ok(long.querySelector('.avatar-initials').classList
                  .contains('avatar-long'));

    // Local self-tile falls back to the remembered server username.
    let self = win.document.createElement('div');
    self.innerHTML = '<span class="avatar-initials"></span>';
    win.setAvatarText(self, {username: null, up: true});
    assert.equal(self.querySelector('.avatar-initials').textContent, '?');

    // Lobby row keeps the short initials avatar.
    let row = rowWithStatus(win, makeUserinfo({username: 'Ada Lovelace'}));
    assert.equal(row.querySelector('.user-avatar').textContent, 'AL');
});

test('tile name plates show the participant and can fall back', async (t) => {
    let app = await loadApp({});
    t.after(() => app.close());
    let win = app.window;
    let doc = win.document;

    function labelWith(c, fallback) {
        let elt = doc.createElement('div');
        elt.id = 'label-x';
        doc.body.appendChild(elt);
        win.setLabel(c, fallback);
        doc.body.removeChild(elt);
        return elt;
    }

    // Remote down-stream: named by the remote user.
    let remote = labelWith({localId: 'x', username: 'Bob', up: false});
    assert.equal(remote.textContent, 'Bob');
    assert.equal(remote.dataset.name, 'Bob');

    // Local up-stream with no server connection: stays empty (hidden).
    let own = labelWith({localId: 'x', username: null, up: true});
    assert.equal(own.textContent, '');
    assert.equal(own.dataset.name, undefined);

    // A stats fallback (bitrate figures) fills the label when unnamed.
    let fb = labelWith({localId: 'x', username: null, up: true}, '123+45');
    assert.equal(fb.textContent, '123+45');
    assert.ok(fb.classList.contains('label-fallback'));
});

