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
