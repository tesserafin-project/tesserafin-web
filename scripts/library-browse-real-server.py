#!/usr/bin/env python3
"""LIBRARY-BROWSE, real server: do pages read the sequence the seeded rows must produce, under ties?

Run through the server repository's ci/serve-e2e.sh --exec, on a throwaway library:
  python3 scripts/library-browse-real-server.py [movies] [series]

The expected sequence is computed here from each row's metadata, ending on the Id (see
docs/ux/library-browsing.md), not from another query that could share a defect. Prints one line per
sort and page size, then a JSON summary on the last line. Exit 1 if any sequence differs.
"""
import json, os, shutil, statistics, sys, time, urllib.parse, urllib.request

B = os.environ['TESSERAFIN_E2E_BASE_URL']
AUTH = 'MediaBrowser Client="lbr2", Device="rig", DeviceId="lbr2", Version="1"'
MOVIES = int(sys.argv[1]) if len(sys.argv) > 1 else 400
SERIES = int(sys.argv[2]) if len(sys.argv) > 2 else 150
LIMITS = (24, 37, 100)
SAME_TIME = 1600000000
PLAYED_DATES = ['2024-01-01T00:00:00.0000000Z', '2025-01-01T00:00:00.0000000Z', None]
timings = []


def call(path, method='GET', body=None, token=None):
    headers = {'Authorization': AUTH + (f', Token="{token}"' if token else ''), 'Content-Type': 'application/json'}
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(B + path, method=method, headers=headers, data=data)
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


login = call('/Users/AuthenticateByName', 'POST', {'Username': os.environ['TESSERAFIN_E2E_USER'], 'Pw': os.environ['TESSERAFIN_E2E_PASSWORD']})
token, user_id = login['AccessToken'], login['User']['Id']
folders = call('/Library/VirtualFolders', token=token)
movies_folder = next(f for f in folders if f.get('CollectionType') == 'movies')
movies_root = movies_folder['Locations'][0]
source = next(os.path.join(d, n) for d, _, names in os.walk(movies_root) for n in names if n.endswith('.mp4'))
data_root = os.path.dirname(movies_root)


def place(directory, name):
    os.makedirs(directory, exist_ok=True)
    target = os.path.join(directory, name)
    if not os.path.exists(target):
        os.link(source, target)
    os.utime(target, (SAME_TIME, SAME_TIME))
    os.utime(directory, (SAME_TIME, SAME_TIME))


# Most films tie on year and date; thirty tie on title too.
for i in range(MOVIES - 30):
    place(os.path.join(movies_root, f'Tied Film {i:04d} (2000)'), f'Tied Film {i:04d} (2000).mp4')
for i in range(30):
    place(os.path.join(movies_root, f'dup{i:02d}', 'Same Title (2000)'), 'Same Title (2000).mp4')

shows_root = os.path.join(data_root, 'lbr2-shows')
for i in range(SERIES):
    show = os.path.join(shows_root, f'Tied Show {i:04d} (2000)', 'Season 01')
    place(show, f'Tied Show {i:04d} S01E01.mp4')
    place(show, f'Tied Show {i:04d} S01E02.mp4')
call('/Library/VirtualFolders?' + urllib.parse.urlencode({'name': 'Shows', 'collectionType': 'tvshows', 'refreshLibrary': 'false'}), 'POST',
     {'LibraryOptions': {'PathInfos': [{'Path': shows_root}]}}, token)
call('/Library/Refresh', 'POST', token=token)
views = call('/UserViews?userId=' + user_id, token=token)['Items']
movies_id = next(v['Id'] for v in views if v.get('CollectionType') == 'movies')
shows_id = next(v['Id'] for v in views if v.get('CollectionType') == 'tvshows')


def query(parent, kind, sort, order, start, limit):
    params = [('userId', user_id), ('parentId', parent), ('includeItemTypes', kind), ('recursive', 'true'),
              ('fields', 'SortName,DateCreated'), ('startIndex', start), ('limit', limit)]
    params += [('sortBy', ','.join(sort)), ('sortOrder', ','.join(order))]
    started = time.perf_counter()
    result = call('/Items?' + urllib.parse.urlencode(params), token=token)
    timings.append(time.perf_counter() - started)
    return result


def wait_for(parent, kind, wanted):
    # Reaching `wanted` does not end the scan: a row added after the sequence was read moves every
    # later one, and reads as a server defect. Wait until the count has stopped changing as well.
    total = 0
    steady = 0
    for _ in range(240):
        previous = total
        total = query(parent, kind, ['SortName'], ['Ascending'], 0, 1)['TotalRecordCount']
        steady = steady + 1 if total == previous else 0
        if total >= wanted and steady >= 3:
            return total
        time.sleep(5)
    raise SystemExit(f'{kind}: only {total} of {wanted} indexed')


movie_total = wait_for(movies_id, 'Movie', MOVIES)
series_total = wait_for(shows_id, 'Series', SERIES)
episode_total = wait_for(shows_id, 'Episode', SERIES * 2)
print('indexed', movie_total, series_total, episode_total, flush=True)

# Ties on the played date, including never played (NULL).
series_rows = query(shows_id, 'Series', ['SortName'], ['Ascending'], 0, series_total)['Items']
series_played = {}
for index, row in enumerate(series_rows):
    played = PLAYED_DATES[index % 3]
    series_played[row['Id']] = played
    if played:
        episodes = call(f'/Shows/{row["Id"]}/Episodes?userId={user_id}', token=token)['Items']
        for episode in episodes:
            call(f'/UserPlayedItems/{episode["Id"]}?' + urllib.parse.urlencode({'userId': user_id, 'datePlayed': played}), 'POST', token=token)


def rank(value, ascending):
    """NULL compares lowest, as in SQLite. Returns a key whose natural order is the requested one."""
    present = value is not None
    return (present, value) if ascending else (not present, Reversed(value))


class Reversed:
    def __init__(self, value):
        self.value = value

    def __eq__(self, other):
        return self.value == other.value

    def __lt__(self, other):
        if self.value is None or other.value is None:
            return False
        return self.value > other.value


FIELD = {
    'SortName': lambda r: r.get('SortName'),
    'Name': lambda r: r.get('Name'),
    'ProductionYear': lambda r: r.get('ProductionYear'),
    'CommunityRating': lambda r: r.get('CommunityRating'),
    'DateCreated': lambda r: r.get('DateCreated'),
    'SeriesDatePlayed': lambda r: series_played.get(r['Id']),
}


def expected(rows, keys):
    """keys: (field, ascending). The Id's stored text sorts as its hex digits do."""
    return [r['Id'] for r in sorted(rows, key=lambda r: tuple(rank(FIELD[f](r), a) for f, a in keys) + (r['Id'],))]


def sort_keys(sort, order):
    """What ApplyOrder adds to the request: Name after a leading SortName, SortName when nothing sorted by name."""
    keys = []
    for index, (field, direction) in enumerate(zip(sort, order)):
        ascending = direction == 'Ascending'
        keys.append((field, ascending))
        if index == 0 and field == 'SortName':
            keys.append(('Name', ascending))
    if not any(f in ('SortName', 'Name') for f in sort):
        keys.append(('SortName', True))
    return keys


cases = []
for field, direction in [('SortName', 'Ascending'), ('SortName', 'Descending'), ('ProductionYear', 'Descending'),
                         ('CommunityRating', 'Descending'), ('DateCreated', 'Descending')]:
    cases.append(('Movie', movies_id, movie_total, [field], [direction]))
    ties = [t for t in ('SortName', 'ProductionYear', 'DateCreated') if t != field]
    cases.append(('Movie', movies_id, movie_total, [field] + ties, [direction] + ['Ascending'] * len(ties)))
cases.append(('Series', shows_id, series_total, ['SortName'], ['Ascending']))
cases.append(('Series', shows_id, series_total, ['ProductionYear', 'SortName', 'DateCreated'], ['Descending', 'Ascending', 'Ascending']))
cases.append(('Series', shows_id, series_total, ['SeriesDatePlayed'], ['Descending']))
cases.append(('Series', shows_id, series_total, ['SeriesDatePlayed'], ['Ascending']))
cases.append(('Episode', shows_id, episode_total, ['SortName'], ['Ascending']))
cases.append(('Episode', shows_id, episode_total, ['ProductionYear', 'SortName', 'DateCreated'], ['Descending', 'Ascending', 'Ascending']))

failures = 0
results = []
for kind, parent, total, sort, order in cases:
    all_rows = query(parent, kind, ['SortName'], ['Ascending'], 0, total)['Items']
    want = expected(all_rows, sort_keys(sort, order))
    for limit in LIMITS:
        read, totals_ok = [], True
        for start in range(0, total, limit):
            page = query(parent, kind, sort, order, start, limit)
            totals_ok = totals_ok and page['TotalRecordCount'] == total and len(page['Items']) == min(limit, total - start)
            read += [i['Id'] for i in page['Items']]
        past = query(parent, kind, sort, order, total, limit)
        totals_ok = totals_ok and not past['Items'] and past['TotalRecordCount'] == total
        moved = sum(1 for a, b in zip(read, want) if a != b)
        good = read == want and totals_ok
        failures += 0 if good else 1
        results.append({'kind': kind, 'sort': sort, 'order': order, 'limit': limit, 'match': read == want, 'moved': moved,
                        'dup': len(read) - len(set(read)), 'missing': len(set(want) - set(read)), 'totals': totals_ok})
        print(f"{'ok ' if good else 'BAD'} {kind:7} {','.join(sort)} {order[0][:4]} limit={limit} moved={moved} "
              f"dup={results[-1]['dup']} missing={results[-1]['missing']} totals={totals_ok}", flush=True)

random_a = [i['Id'] for i in query(movies_id, 'Movie', ['Random'], ['Ascending'], 0, 100)['Items']]
random_b = [i['Id'] for i in query(movies_id, 'Movie', ['Random'], ['Ascending'], 0, 100)['Items']]
print('Random redraws per request:', random_a != random_b)
if random_a == random_b:
    failures += 1

print(json.dumps({'cases': len(results), 'failures': failures, 'randomRedraws': random_a != random_b,
                  'medianMs': round(statistics.median(timings) * 1000, 1), 'p95Ms': round(statistics.quantiles(timings, n=20)[18] * 1000, 1)}))
sys.exit(1 if failures else 0)
