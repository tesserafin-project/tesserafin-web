#!/usr/bin/env python3
"""LIBRARY-BROWSE-R1, real server: do pages agree with an unpaged query under tied sort values?"""
import json, os, shutil, sys, time, urllib.request, urllib.parse
B=os.environ['TESSERAFIN_E2E_BASE_URL']
AUTH='MediaBrowser Client="lbr1", Device="rig", DeviceId="lbr1", Version="1"'
def call(path, method='GET', body=None, token=None):
    h={'Authorization': AUTH+(f', Token="{token}"' if token else ''), 'Content-Type':'application/json'}
    r=urllib.request.Request(B+path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r, timeout=60) as f:
        d=f.read(); return json.loads(d) if d else None
a=call('/Users/AuthenticateByName','POST',{'Username':os.environ['TESSERAFIN_E2E_USER'],'Pw':os.environ['TESSERAFIN_E2E_PASSWORD']})
tok,uid=a['AccessToken'],a['User']['Id']
folders=call('/Library/VirtualFolders',token=tok)
mv=next(f for f in folders if f.get('CollectionType')=='movies')
root=mv['Locations'][0]; print('library root',root)
src=next(os.path.join(d,n) for d,_,ns in os.walk(root) for n in ns if n.endswith(('.mkv','.mp4')))
ext=os.path.splitext(src)[1]
N=int(sys.argv[1]) if len(sys.argv)>1 else 230
for i in range(N-30):
    d=os.path.join(root,f'Tied Film {i:04d} (2000)'); os.makedirs(d,exist_ok=True); shutil.copy(src,os.path.join(d,f'Tied Film {i:04d} (2000){ext}'))
for i in range(30):
    d=os.path.join(root,f'dup{i:02d}','Same Title (2000)'); os.makedirs(d,exist_ok=True); shutil.copy(src,os.path.join(d,f'Same Title (2000){ext}'))
call('/Library/Refresh','POST',token=tok)
pid=mv['ItemId']
def q(sort,order,start,limit):
    p=[('userId',uid),('parentId',pid),('includeItemTypes','Movie'),('recursive','true'),('startIndex',start),('limit',limit)]
    p+=[('sortBy',s) for s in sort]+[('sortOrder',o) for o in order]
    return call('/Items?'+urllib.parse.urlencode(p),token=tok)
for _ in range(120):
    t=q(['SortName'],['Ascending'],0,1)['TotalRecordCount']
    if t>=N: break
    time.sleep(5)
print('total',t)
def compare(label,sort,order):
    res=[]
    for limit in (24,37,100):
        whole=[i['Id'] for i in q(sort,order,0,t)['Items']]
        paged=[]
        for s in range(0,t,limit): paged+=[i['Id'] for i in q(sort,order,s,limit)['Items']]
        res.append(f"limit={limit} dup={len(paged)-len(set(paged))} missing={len(set(whole)-set(paged))} sameOrder={paged==whole}")
    print(label,sort,'|',' ; '.join(res))
T=['SortName','ProductionYear','DateCreated']
A,D='Ascending','Descending'
for s,o in [('ProductionYear',D),('CommunityRating',D),('DateCreated',D),('SortName',A)]:
    compare('bare',[s],[o])
    ties=[x for x in T if x!=s]
    compare('tiebroken',[s]+ties,[o]+[A]*len(ties))
a1=[i['Id'] for i in q(['Random'],[A],0,100)['Items']]; a2=[i['Id'] for i in q(['Random'],[A],100,100)['Items']]
print('Random two pages of 100 of',t,'overlap',len(set(a1)&set(a2)),'; same first page again equal:',a1==[i['Id'] for i in q(['Random'],[A],0,100)['Items']])
