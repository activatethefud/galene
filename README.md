# The Galene videoconferencing system

> **Unofficial fork — not affiliated with the Galene project.**
> All credit for Galene goes to [jech/galene](https://github.com/jech/galene)
> and its contributors. This repository is a personal fork maintained by
> **activatethefud** that experiments with the web client UI (Jitsi-style
> Mic/Camera toggles with a live login preview, per-user media indicators,
> generated avatars, auto-login, and visual refreshes). The Go server is
> unmodified upstream code. Please report upstream issues to the original
> repository.

Galene is a fully-featured videoconferencing system that is easy to deploy
and requires very moderate server resources.  It is described at
<https://galene.org>.

## Differences from upstream

This fork is based on Galene v1.2 (`38fda0a`).  The **Go server is
unmodified upstream code** — only the web client has been changed.  The
main differences from [jech/galene](https://github.com/jech/galene) are:

* **Separate Mic and Camera toggles.**  The old "Enable at start" radios
  and Enable/Disable/Mute buttons are replaced with Jitsi-style Mic and
  Camera toggle buttons, both on the Connect screen and in the room top
  bar, with clear on/off states.
* **Live login preview.**  On the Connect screen the toggles start/stop a
  real camera preview (mirrored self-view) and a microphone level meter,
  so you can check your devices *before* joining.  Camera and microphone
  default to **on**.
* **Auto-login and remembered state.**
  * `galene.username` — last username pre-filled.
  * `galene.media` — your last Mic/Camera on/off choices, restored on
    return (auto-login starts media as you left it).
  * `galene.login` — password logins are remembered for 24h of inactivity
    and auto-log you back in.
  * `galene.invite` — invite-link (token) logins are remembered too:
    invited users who only type a username are recognised again and can
    rejoin — even under a new name — without a fresh invite link.  Logging
    out forgets your password but keeps the invite token.
* **Better in-room feedback.**
  * A floating **on-air pill** shows while your mic/camera are live.
  * Every participant row shows Mic and Camera icons mirroring the top bar
    (red crossed-out mic when a user is muted or off) plus an **initials
    avatar**; raised hands appear as a badge.
  * When a participant's camera is off but their mic is on, their video
    tile shows a generated **avatar with their initials** instead of a
    black canvas.
* **Visual refresh.**  The CSS was modernised (flat colours, rounded
  corners, hover/focus states, refreshed login panel and toasts).

The client behaviour is exercised by an extensive jsdom test-suite under
`static/test/` (run with `npm test`).

## Quick start

```sh
git clone https://github.com/jech/galene
cd galene
CGO_ENABLED=0 go build -ldflags='-s -w'
mkdir groups
echo '{"users": {"vimes": {"password":"sybil", "permissions":"op"}}}' > groups/night-watch.json
./galene &
```

Point your browser at <https://localhost:8443/group/night-watch/>, ignore
the unknown certificate warning, and log in with username *vimes* and
password *sybil*.

For full installation instructions, please see the file [galene-install.md][1]
in this directory.

## Documentation

  * [galene-install.md][1]: full installation instructions
  * [galene.md][2]: usage and administration;
  * [galene-client.md][3]: writing clients;
  * [galene-protocol.md][4]: the client protocol;
  * [galene-api.md][5]: Galene's administrative API.
  
## Contributing

In order to contribute to Galene, you may:

  * send patches to [the Galene mailing list][6] by sending mail to
    <galene@lists.galene.org>;
  * submit pull requests on GitHub.

For general discussion, please use the [Galene mailing list][6] (feel free
to send mail without subscribing).  Please do not use Github for general
discussion.

## Further information

Galène's web page is at <https://galene.org>.

Answers to common questions and issues are at <https://galene.org/faq.html>.


-- Juliusz Chroboczek <https://www.irif.fr/~jch/>

[1]: <galene-install.md>
[2]: <galene.md>
[3]: <galene-client.md>
[4]: <galene-protocol.md>
[5]: <galene-api.md>
[6]: <https://lists.galene.org/>
