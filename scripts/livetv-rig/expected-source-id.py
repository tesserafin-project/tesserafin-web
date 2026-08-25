"""Derive the tuner media-source id this rig's fixture OWNS, before any PlaybackInfo request.

WHY THIS EXISTS

The acceptance gate used to accept any returned media-source id that merely differed from the
channel item id (#153-WEB-R1 finding F4-1). That is a negative property: a server answering with
a wrong-but-different id passed. Grading the positive property needs an expected id obtained
WITHOUT reading the response under test.

WHERE THE EXPECTED ID COMES FROM

The server derives an M3U channel's media-source id from the channel's PATH, and that path is the
URL line this rig's own `make-fixture.sh` wrote into `fixture/playlist.m3u`:

    src/Tesserafin.LiveTv/TunerHosts/M3uParser.cs:106
        channel.Path = trimmedLine                       # the trimmed non-'#' playlist line
    src/Tesserafin.LiveTv/TunerHosts/M3UTunerHost.cs:195
        Id = channel.Path.GetMD5().ToString("N", CultureInfo.InvariantCulture)
    Tesserafin.Common/Extensions/BaseExtensions.cs:30
        GetMD5 => new Guid(MD5.HashData(Encoding.Unicode.GetBytes(str)))

So the id is MD5 over the UTF-16LE bytes of that URL, re-read through the .NET `Guid(byte[])`
little-endian field layout (the first three fields are byte-swapped), formatted as 32 lowercase
hex digits with no dashes.

WHY THIS IS AN INDEPENDENT ORACLE

The INPUT is fixture-owned. `make-fixture.sh` writes the playlist line before the tuner host is
registered, before the channel is indexed and long before the PlaybackInfo request being graded
exists. Nothing in the response can change it. Only the HASH CONTRACT is replicated from the
server, deliberately and with the three source anchors above: replicating a pure function of a
value we own is not the same as deriving the expectation from the system under test.

USAGE

    python3 scripts/livetv-rig/expected-source-id.py scripts/livetv-rig/fixture/playlist.m3u
    f00baff0a649bca042e0aca880a6eaad
"""

import hashlib
import sys
import uuid


def channel_path(playlist_path):
    """The first non-comment, non-blank line of the M3U - what M3uParser assigns to channel.Path."""
    with open(playlist_path, "r", encoding="utf-8") as handle:
        for line in handle:
            trimmed = line.strip()
            if not trimmed or trimmed.startswith("#"):
                continue
            return trimmed
    raise SystemExit("no channel url line in %s" % playlist_path)


def media_source_id(path):
    digest = hashlib.md5(path.encode("utf-16-le")).digest()
    return uuid.UUID(bytes_le=digest).hex


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: expected-source-id.py <playlist.m3u>")
    print(media_source_id(channel_path(sys.argv[1])))
