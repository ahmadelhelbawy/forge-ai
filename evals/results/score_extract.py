import json, re, yaml
STOP = set('the and for with from that this are was what where which when how does mean here there must not any into over under than then them they its per has have had our you your she him her his their our out about into through during than too very can will just don should now'.split())
def sig(s):
    return [w for w in re.findall(r'[a-z0-9]+', s.lower()) if len(w) > 3 and w not in STOP]
def containment(expected, texts):
    blob = ' '.join(texts)
    hits = [e for e in expected if sum(1 for w in sig(e) if w in blob) / max(1, len(sig(e))) >= 0.6]
    return hits
tasks = {t['id']: t for t in yaml.safe_load(open('evals/corpus/tasks.yaml'))}
rows = {}
for tid, t in tasks.items():
    try: ir = json.load(open(f'evals/results/ir/{tid}.json'))
    except FileNotFoundError: rows[tid] = {'status': 'no-ir'}; continue
    goals = [g['statement'] + ' ' + ' '.join(g['acceptance']) for g in ir['goals']]
    constr = [c['statement'] for c in ir['constraints']] + [' '.join(ir['scope']['include'])]
    qs = [q['question'] for q in ir['open_questions']]
    everywhere = goals + constr + [d['description'] for d in ir['deliverables']] + [a['statement'] for a in ir['assumptions']]
    rows[tid] = {
      'goals_hit': containment(t['expected_goals'], everywhere),
      'goals_miss': [e for e in t['expected_goals'] if e not in containment(t['expected_goals'], everywhere)],
      'constr_hit': containment(t['expected_constraints'], constr),
      'constr_miss': [e for e in t['expected_constraints'] if e not in containment(t['expected_constraints'], constr)],
      'q_hit': containment(t['expected_questions'], qs),
      'q_miss': [e for e in t['expected_questions'] if e not in containment(t['expected_questions'], qs)],
      'forbidden_hit': containment(t['forbidden'], everywhere),
      'n_goals': len(ir['goals']), 'n_constr': len(ir['constraints']),
      'n_q': len(ir['open_questions']), 'n_blocking': sum(1 for q in ir['open_questions'] if q['blocking']),
      'scope_include': ir['scope']['include'],
    }
json.dump(rows, open('evals/results/extraction-scores.json','w'), indent=2)
for tid, r in rows.items():
    if r.get('status'): print(tid, 'NO-IR'); continue
    print(f"{tid} goals {len(r['goals_hit'])}/{len(tasks[tid]['expected_goals'])} miss={r['goals_miss']}")
    print(f"   constr {len(r['constr_hit'])}/{len(tasks[tid]['expected_constraints'])} miss={r['constr_miss']}")
    print(f"   quest {len(r['q_hit'])}/{len(tasks[tid]['expected_questions'])} miss={r['q_miss']}")
    print(f"   FORBIDDEN hit={r['forbidden_hit']} | blocking={r['n_blocking']} scope={r['scope_include']}")
