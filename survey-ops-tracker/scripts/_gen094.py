import re, io, sys

def grab(path, header):
    """Extract one function verbatim, from its create-or-replace line to the
    matching `end $$;`. Verbatim on purpose: create-or-replace cannot patch a
    single statement, so the only safe rebuild is the live body plus new lines."""
    src = open(path, encoding='utf-8').read()
    i = src.index(header)
    j = src.index('\nend $$;', i) + len('\nend $$;')
    return src[i:j]

def splice_after(body, anchor_substr, new_lines, what):
    lines = body.split('\n')
    for k, ln in enumerate(lines):
        if anchor_substr in ln:
            return '\n'.join(lines[:k+1] + new_lines + lines[k+1:])
    sys.exit(f'ANCHOR NOT FOUND ({what}): {anchor_substr!r}')

M = 'supabase/migrations/'

audit = grab(M+'088_audit_rerun_wiring.sql',
             'create or replace function public.audit_survey_project()')
audit = splice_after(audit,
    "audit_field(NEW.id, 'audience_size'",
    ["  perform audit_field(NEW.id, 'audience_used', OLD.audience_used::text, NEW.audience_used::text, actor);"],
    'audit')

write = grab(M+'078_n_target_range.sql',
             'create or replace function public.mcp_write_project(')
write = splice_after(write,
    "audience_size      = case when p_patch ? 'audience_size'",
    ["    audience_used      = case when p_patch ? 'audience_used'      then nullif(p_patch->>'audience_used','')::int else audience_used end,"],
    'mcp_write_project')

seg = grab(M+'084_segment_note.sql',
           'create or replace function public.mcp_update_segment(')
seg = splice_after(seg,
    "n_actual    = case when p_patch ? 'n_actual'",
    ["    audience    = case when p_patch ? 'audience'    then p_patch->>'audience' else audience end,",
     "    audience_size = case when p_patch ? 'audience_size' then nullif(p_patch->>'audience_size','')::int else audience_size end,",
     "    audience_used = case when p_patch ? 'audience_used' then nullif(p_patch->>'audience_used','')::int else audience_used end,"],
    'mcp_update_segment')

# The spliced n_actual line needs its trailing comma now that lines follow it.
seg = seg.replace(
    "    n_actual    = case when p_patch ? 'n_actual'    then nullif(p_patch->>'n_actual','')::int else n_actual end\n",
    "    n_actual    = case when p_patch ? 'n_actual'    then nullif(p_patch->>'n_actual','')::int else n_actual end,\n")

open('scripts/_094_parts.sql','w',encoding='utf-8').write(
    '\n\n-- >>>AUDIT<<<\n' + audit + ';\n\n-- >>>WRITE<<<\n' + write + ';\n\n-- >>>SEG<<<\n' + seg + ';\n')

print('audit lines :', audit.count('\n'))
print('write lines :', write.count('\n'))
print('seg   lines :', seg.count('\n'))
print('\n--- sanity: the three new audience_used lines ---')
for b,n in ((audit,'audit'),(write,'write'),(seg,'seg')):
    for ln in b.split('\n'):
        if 'audience' in ln: print(f'  [{n}] {ln.strip()[:100]}')
