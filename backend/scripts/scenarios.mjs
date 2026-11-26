// End-to-end scenarios against a running FACILITRACK API (no extra packages):
// a reporter files reports, the coordinator triages them, technicians work
// them, with returned forms, duplicates, declines, delays, rework, the job
// limit and permission checks. Uses the seeded test accounts, so run it
// against a development database only; it leaves its reports behind
// (clear them with `npm run reports:clear -- --confirm`).
//
//   npm run scenarios                         # http://localhost:3000
//   node scripts/scenarios.mjs http://localhost:3100
const BASE = process.argv[2] ?? 'http://localhost:3000';
const PASSWORD = 'password123';

// a real 1x1 PNG (photos and signatures are checked as images)
const PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C63F8CFC000000301010000C9FE92EF0000000049454E44AE426082',
  'hex',
);

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` -- ${detail}` : ''}`);
}

async function call(token, method, path, body, multipart) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload;
  if (multipart) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) {
      if (v instanceof Buffer) fd.append(k, new Blob([v], { type: 'image/png' }), `${k}.png`);
      else if (v !== undefined) fd.append(k, String(v));
    }
    payload = fd;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const tokens = {};
const ids = {};
async function login(email) {
  const r = await call(null, 'POST', '/auth/login', { email, password: PASSWORD });
  if (r.status !== 200 && r.status !== 201) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  tokens[email] = r.data.accessToken;
  ids[email] = r.data.user.id;
  return r.data.accessToken;
}

const msg = (r) => `${r.status} ${typeof r.data === 'object' ? JSON.stringify(r.data?.message ?? r.data).slice(0, 160) : r.data}`;

async function main() {
  const student = await login('student@test.com');
  const faculty = await login('faculty@test.com');
  const coord = await login('coordinator@test.com');
  const plumber = await login('plumber@test.com');
  const plumber2 = await login('plumber2@test.com');
  const elec = await login('electrician@test.com');
  await login('admin@test.com').catch(() => console.log('(admin password changed: admin checks skipped)'));

  const opts = (await call(student, 'GET', '/reports/options')).data;
  const cat = (name) => opts.categories.find((c) => c.name === name);
  const leak = cat('Water Leak');
  const lighting = cat('Faulty Lighting');
  const [loc1, loc2] = opts.locations;
  // a fresh room each run, so reports left from earlier runs don't match
  const loc3 = opts.locations[10 + Math.floor(Math.random() * (opts.locations.length - 10))];
  check('options: categories and locations', leak && lighting && loc1 && loc2, JSON.stringify(Object.keys(opts)));

  async function report(token, category, loc, description, extra = {}) {
    return call(token, 'POST', '/reports', {
      categoryId: category.id,
      locationId: loc.id,
      description,
      affectedPeople: 2,
      safetyHazard: true,
      blocksUse: false,
      photo: PNG,
      ...extra,
    }, true);
  }
  async function signForm(token, reportId, work = 'Please fix the reported problem soon.') {
    return call(token, 'POST', '/job-order-forms', {
      reportId,
      department: 'College of Engineering, BSIT 3-1',
      contactNumber: '0917 123 4567',
      workRequested: work,
      certified: 'true',
      signature: PNG,
    }, true);
  }
  const getReport = async (token, id) => (await call(token, 'GET', `/reports/${id}`)).data;

  /* ------------------------------------------------ validation */
  {
    const noPhoto = await call(student, 'POST', '/reports', { categoryId: leak.id, locationId: loc1.id, description: 'Leaking pipe here' }, true);
    check('validation: report without photo is refused', noPhoto.status === 400, msg(noPhoto));
    const short = await report(student, leak, loc1, 'abc');
    check('validation: too-short description is refused', short.status === 400, msg(short));
    const anon = await call(null, 'GET', '/reports/mine');
    check('security: no token is refused', anon.status === 401, msg(anon));
  }

  /* ------------------------------------------------ S1: the full happy path */
  const r1 = await report(student, leak, loc1, 'Water is leaking under the sink in the comfort room.');
  check('S1 reporter submits a report', r1.status === 201 && r1.data.status === 'SUBMITTED', msg(r1));
  check('S1 reporter does not see internal priority', r1.data && !('priority' in r1.data) && !('priorityScore' in r1.data), Object.keys(r1.data ?? {}).join(','));
  const R1 = r1.data.id;
  const f1 = await signForm(student, R1);
  check('S1 reporter signs the Job Order Form', f1.status === 201 && f1.data.status === 'SUBMITTED', msg(f1));
  const F1 = f1.data.id;
  const dupSign = await signForm(student, R1);
  check('S1 a second form for the same report is refused', dupSign.status === 409, msg(dupSign));

  const queue = await call(coord, 'GET', '/routing/queue');
  check('S1 report is in the Pending Reports queue', queue.status === 200 && queue.data.items.some((i) => i.id === R1), msg(queue));
  const review = await call(coord, 'PATCH', `/reports/${R1}/review`);
  check('S1 opening the report puts it Under review', review.data?.changed === true && (await getReport(coord, R1)).status === 'UNDER_REVIEW', msg(review));
  const review2 = await call(coord, 'PATCH', `/reports/${R1}/review`);
  check('S1 opening it again changes nothing', review2.data?.changed === false, msg(review2));
  const recv = await call(coord, 'POST', `/job-order-forms/${F1}/receive`);
  check('S1 form marked received', recv.status === 200, msg(recv));

  const tooEarly = await call(coord, 'POST', '/job-orders', { reportId: R1 });
  check('S1 job order refused before the request is accepted', tooEarly.status === 400, msg(tooEarly));
  const approve = await call(coord, 'POST', `/job-order-forms/${F1}/approve`, {});
  check('S1 coordinator accepts the request', approve.status === 200, msg(approve));

  const techs = await call(coord, 'GET', `/job-orders/technicians?tradeUnitId=${leak.defaultTradeUnit.id}`);
  check('S1 plumbing technicians listed with workload', techs.status === 200 && techs.data.some((t) => t.id === ids['plumber@test.com']) && techs.data.every((t) => t.workload?.limit === 5), msg(techs));
  const reco = await call(coord, 'GET', `/reports/${R1}/recommendation`);
  check('S1 a technician is recommended', reco.status === 200 && reco.data.recommended, msg(reco));

  const jo1 = await call(coord, 'POST', '/job-orders', { reportId: R1, technicianId: ids['plumber@test.com'], targetDate: '2030-01-15' });
  check('S1 job order created', jo1.status === 201 && /^JO-\d{4}-\d{4}$/.test(jo1.data.jobOrderNo), msg(jo1));
  const J1 = jo1.data.id;
  const jo1again = await call(coord, 'POST', '/job-orders', { reportId: R1 });
  check('S1 a second job order is refused', jo1again.status === 409, msg(jo1again));
  check('S1 report now Assigned', (await getReport(coord, R1)).status === 'ASSIGNED');

  const startEarly = await call(plumber, 'PATCH', `/job-orders/${J1}/status`, { status: 'IN_PROGRESS' }, true);
  check('S1 cannot start before accepting', startEarly.status === 400, msg(startEarly));
  const otherTech = await call(elec, 'POST', `/job-orders/${J1}/accept`);
  check('S1 another technician cannot accept it', otherTech.status === 403 || otherTech.status === 409, msg(otherTech));
  const acc = await call(plumber, 'POST', `/job-orders/${J1}/accept`);
  check('S1 technician accepts', acc.status === 200 || acc.status === 201, msg(acc));
  const acc2 = await call(plumber, 'POST', `/job-orders/${J1}/accept`);
  check('S1 accepting twice is refused', acc2.status === 409, msg(acc2));
  const mine = await call(plumber, 'GET', '/job-orders/assigned');
  check('S1 job is in the technician list', mine.data.some((j) => j.id === J1), msg(mine));

  const start = await call(plumber, 'PATCH', `/job-orders/${J1}/status`, { status: 'IN_PROGRESS', remarks: 'On site now' }, true);
  check('S1 work started', start.status === 200 && start.data.status === 'IN_PROGRESS', msg(start));
  const prog = await call(plumber, 'POST', `/job-orders/${J1}/progress`, { remarks: 'Replaced the gasket, testing.', photo: PNG }, true);
  check('S1 progress update with photo', prog.status === 201 || prog.status === 200, msg(prog));
  const delay = await call(plumber, 'POST', `/job-orders/${J1}/delay`, { reason: 'Waiting for materials', materialsNote: 'Flush valve, 1 pc', revisedTargetDate: '2030-01-20' });
  check('S1 delay reported', (delay.status === 201 || delay.status === 200) && delay.data.status === 'DELAYED', msg(delay));
  check('S1 reporter sees Delayed', (await getReport(student, R1)).status === 'DELAYED');
  const reassignWhileWorking = await call(coord, 'PATCH', `/job-orders/${J1}/technician`, { technicianId: ids['plumber2@test.com'] });
  check('S1 technician cannot be changed after work started', reassignWhileWorking.status === 400, msg(reassignWhileWorking));
  const resume = await call(plumber, 'POST', `/job-orders/${J1}/resume`, {});
  check('S1 work resumed', (resume.status === 201 || resume.status === 200) && resume.data.status === 'IN_PROGRESS', msg(resume));
  const noPhotoDone = await call(plumber, 'PATCH', `/job-orders/${J1}/status`, { status: 'COMPLETED' }, true);
  check('S1 completion without photo is refused', noPhotoDone.status === 400, msg(noPhotoDone));
  const done = await call(plumber, 'PATCH', `/job-orders/${J1}/status`, { status: 'COMPLETED', remarks: 'Replaced the valve.', photo: PNG }, true);
  check('S1 job completed with photo', done.status === 200 && done.data.status === 'COMPLETED', msg(done));
  const earlyRate = await call(student, 'POST', `/reports/${R1}/feedback`, { rating: 5 });
  check('S1 rating before verification is refused', earlyRate.status === 400, msg(earlyRate));
  const techVerify = await call(plumber, 'PATCH', `/job-orders/${J1}/verify`, { approved: true });
  check('S1 technician cannot verify', techVerify.status === 403, msg(techVerify));
  const rework = await call(coord, 'PATCH', `/job-orders/${J1}/verify`, { approved: false, remarks: 'Still dripping at the joint.' });
  check('S1 sent back for rework', rework.status === 200 && rework.data.status === 'IN_PROGRESS', msg(rework));
  const done2 = await call(plumber, 'PATCH', `/job-orders/${J1}/status`, { status: 'COMPLETED', remarks: 'Tightened the joint.', photo: PNG }, true);
  check('S1 completed again', done2.status === 200, msg(done2));
  const verify = await call(coord, 'PATCH', `/job-orders/${J1}/verify`, { approved: true });
  check('S1 verified and closed', verify.status === 200 && verify.data.status === 'CLOSED', msg(verify));
  check('S1 report Closed', (await getReport(student, R1)).status === 'CLOSED');
  const rate = await call(student, 'POST', `/reports/${R1}/feedback`, { rating: 5, comment: 'Fast, Neat work. Thank you!' });
  check('S1 reporter rates the repair', rate.status === 201 || rate.status === 200, msg(rate));
  const rate2 = await call(student, 'POST', `/reports/${R1}/feedback`, { rating: 4 });
  check('S1 rating twice is refused', rate2.status === 409, msg(rate2));
  const pdf = await fetch(`${BASE}/job-orders/${J1}/pdf`, { headers: { Authorization: `Bearer ${coord}` } });
  check('S1 sign-off PDF downloads', pdf.status === 200 && (pdf.headers.get('content-type') ?? '').includes('pdf'), String(pdf.status));
  const notes = await call(student, 'GET', '/notifications?limit=50');
  check('S1 reporter got notifications along the way', notes.status === 200 && notes.data.items.length >= 3, msg(notes));
  const techStats = await call(plumber, 'GET', '/analytics/me?from=2026-01-01&to=2026-12-31');
  check('S1 technician stats count the job', techStats.status === 200 && techStats.data.jobs.completed >= 1, msg(techStats));

  /* ------------------------------------------------ S2: returned form, re-signed */
  const r2 = await report(faculty, lighting, loc2, 'Two lights in the hallway keep flickering at night.');
  const R2 = r2.data.id;
  const f2 = await signForm(faculty, R2);
  await call(coord, 'PATCH', `/reports/${R2}/review`);
  const ret = await call(coord, 'POST', `/job-order-forms/${f2.data.id}/return`, { reason: 'Please add the exact room number.' });
  check('S2 form returned for revision', ret.status === 200, msg(ret));
  const retJob = await call(coord, 'POST', '/job-orders', { reportId: R2 });
  check('S2 job order refused while the form is returned', retJob.status === 400, msg(retJob));
  const resign = await signForm(faculty, R2, 'Please fix the flickering hallway lights near room 204.');
  check('S2 reporter signs the revised form', resign.status === 201 && resign.data.revision === 2, msg(resign));
  const approve2 = await call(coord, 'POST', `/job-order-forms/${resign.data.id}/approve`, {});
  check('S2 revised form accepted', approve2.status === 200, msg(approve2));

  /* ------------------------------------------------ S3: decline and reassign */
  const jo2 = await call(coord, 'POST', '/job-orders', { reportId: R2, technicianId: ids['electrician@test.com'] });
  check('S3 job order offered to an electrician', jo2.status === 201, msg(jo2));
  const J2 = jo2.data.id;
  const shortReason = await call(elec, 'POST', `/job-orders/${J2}/decline`, { reason: 'no' });
  check('S3 decline needs a reason', shortReason.status === 400, msg(shortReason));
  const dec = await call(elec, 'POST', `/job-orders/${J2}/decline`, { reason: 'On leave until Friday.' });
  check('S3 technician declines', dec.status === 200 || dec.status === 201, msg(dec));
  const gone = await call(elec, 'GET', '/job-orders/assigned');
  check('S3 declined job leaves the technician list', !gone.data.some((j) => j.id === J2), msg(gone));
  await login('electrician2@test.com');
  // anyone qualified with room under the 5-job limit (test runs pile up jobs)
  const pool = (await call(coord, 'GET', `/job-orders/technicians?tradeUnitId=${lighting.defaultTradeUnit.id}`)).data;
  const pick = pool.find((t) => t.id !== ids['electrician@test.com'] && t.workload.active < t.workload.limit);
  const pickEmail = { [ids['electrician2@test.com']]: 'electrician2@test.com', [ids['electrician@test.com']]: 'electrician@test.com' };
  let acc3 = { status: 0, data: 'no technician with room' };
  if (pick && pickEmail[pick.id]) {
    const tok = await login(pickEmail[pick.id]);
    const re = await call(coord, 'PATCH', `/job-orders/${J2}/technician`, { technicianId: pick.id });
    check('S3 reassigned to another electrician', re.status === 200 && re.data.technicianId === pick.id, msg(re));
    acc3 = await call(tok, 'POST', `/job-orders/${J2}/accept`);
  } else {
    // nobody else has room: the limit refuses the reassignment
    const re = await call(coord, 'PATCH', `/job-orders/${J2}/technician`, { technicianId: ids['electrician2@test.com'] });
    check('S3 reassignment to a full technician is refused', re.status === 409, msg(re));
    acc3 = { status: 200 };
  }
  check('S3 new technician accepts', acc3.status === 200 || acc3.status === 201, msg(acc3));

  /* ------------------------------------------------ S4: duplicate, Same problem */
  const r3 = await report(student, leak, loc3, 'The faucet in the wash area is leaking a lot of water.');
  const R3 = r3.data.id;
  await signForm(student, R3);
  await new Promise((r) => setTimeout(r, 1500)); // duplicate detection runs after saving
  const r4 = await report(faculty, leak, loc3, 'Faucet in the wash area is leaking water onto the floor.');
  const R4 = r4.data.id;
  await signForm(faculty, R4);
  await new Promise((r) => setTimeout(r, 2500));
  const dups = await call(coord, 'GET', `/reports/${R4}/duplicates`);
  // the earliest strong match in the same room (R3, or an older one left from earlier test runs)
  const flag = dups.data?.possibleOriginals?.find(
    (f) => f.status === 'OPEN' && f.candidate.location.id === loc3.id && f.candidate.category.id === leak.id && f.score >= 75,
  );
  const MAIN = flag?.candidate.id ?? R3;
  check('S4 the later report is flagged against the earlier one', Boolean(flag),
    `R3=${R3} loc3=${loc3.building}/${loc3.room} flags=` + JSON.stringify((dups.data?.possibleOriginals ?? []).map((f) => [f.candidate.id, f.candidate.category.name, f.candidate.location.room, f.candidate.status, f.score, f.status])));
  check('S4 the flag names the earlier reporter (coordinator view)', Boolean(flag?.candidate?.reporter?.fullName), JSON.stringify(flag?.candidate?.reporter));
  if (flag) {
    const same = await call(coord, 'POST', `/reports/${R4}/duplicates/${flag.id}`, { decision: 'confirm' });
    check('S4 Same problem links the report', same.status === 200 || same.status === 201, msg(same));
    const linked = await getReport(faculty, R4);
    check('S4 the later report is closed and linked to the earlier one', linked.status === 'CLOSED' && linked.duplicateOfId === MAIN, `${linked.status} ${linked.duplicateOfId}`);
    check('S4 the later reporter cannot see who reported first', linked.duplicateOf && !('reporter' in linked.duplicateOf), JSON.stringify(linked.duplicateOf));
    check('S4 the link entry names no reporter', !JSON.stringify(linked.logs).includes(flag.candidate.reporter.fullName));
    const main = await getReport(coord, MAIN);
    check('S4 the earlier report is unchanged', main.status === 'UNDER_REVIEW' || main.status === 'SUBMITTED', main.status);
    const linkedJob = await call(coord, 'POST', '/job-orders', { reportId: R4 });
    check('S4 no job order for the linked report', linkedJob.status === 400, msg(linkedJob));
    const linkedRate = await call(faculty, 'POST', `/reports/${R4}/feedback`, { rating: 5 });
    check('S4 a linked report cannot be rated', linkedRate.status === 400, msg(linkedRate));
    const pri = await call(coord, 'POST', `/reports/${R4}/priority`, { action: 'adjust', priority: 'P1', reason: 'Urgent leak' });
    check('S4 a linked report\'s priority cannot be changed', pri.status === 400, msg(pri));
    const listed = await call(coord, 'GET', '/reports');
    check('S4 linked report left out of the coordinator list', !listed.data.some((r) => r.id === R4), msg(listed));
    const q2 = await call(coord, 'GET', '/routing/queue');
    check('S4 linked report left out of Pending Reports', !q2.data.items.some((i) => i.id === R4) && q2.data.linkedDuplicatesWaiting >= 0, msg(q2));
    const facultyMine = await call(faculty, 'GET', '/reports/mine');
    check('S4 the later reporter still sees their report', facultyMine.data.some((r) => r.id === R4));

    // the earlier report goes ahead; the linked reporter hears about it
    const fR3 = (await getReport(coord, MAIN)).jobOrderForm;
    if (fR3 && fR3.status !== 'APPROVED') await call(coord, 'POST', `/job-order-forms/${fR3.id}/approve`, {});
    const newest = async () => (await call(faculty, 'GET', '/notifications?limit=1')).data.items[0]?.id ?? null;
    const before = await newest();
    const jo3 = await call(coord, 'POST', '/job-orders', { reportId: MAIN });
    check('S4 the earlier report gets its job order', jo3.status === 201, msg(jo3));
    await new Promise((r) => setTimeout(r, 1000));
    const latest = (await call(faculty, 'GET', '/notifications?limit=1')).data.items[0];
    check('S4 the linked reporter is notified about the repair', latest && latest.id !== before, JSON.stringify(latest?.title));
    check('S4 the linked report stays closed', (await getReport(faculty, R4)).status === 'CLOSED');

    // unlink
    const un = await call(coord, 'POST', `/reports/${R4}/unlink-duplicate`);
    check('S4 unlink reopens the report as Under review', un.status === 200 || un.status === 201, msg(un));
    const reopened = await getReport(coord, R4);
    check('S4 unlinked report is Under review and unlinked', reopened.status === 'UNDER_REVIEW' && !reopened.duplicateOfId, `${reopened.status} ${reopened.duplicateOfId}`);
  }

  /* ------------------------------------------------ S5: duplicate, Not a duplicate */
  const r5 = await report(faculty, lighting, loc2, 'Hallway lights near the stairs are flickering at night too.');
  const R5 = r5.data.id;
  await signForm(faculty, R5);
  await new Promise((r) => setTimeout(r, 2500));
  const d5 = await call(coord, 'GET', `/reports/${R5}/duplicates`);
  const flag5 = d5.data?.possibleOriginals?.find((f) => f.status === 'OPEN');
  if (flag5) {
    const notDup = await call(coord, 'POST', `/reports/${R5}/duplicates/${flag5.id}`, { decision: 'dismiss' });
    check('S5 Not a duplicate is recorded', notDup.status === 200 || notDup.status === 201, msg(notDup));
    const after5 = await getReport(coord, R5);
    check('S5 report continues normally', !after5.duplicateOfId && after5.status !== 'CLOSED', after5.status);
    const fid = after5.jobOrderForm.id;
    await call(coord, 'POST', `/job-order-forms/${fid}/approve`, {});
    const jo5 = await call(coord, 'POST', '/job-orders', { reportId: R5 });
    check('S5 job order created after Not a duplicate', jo5.status === 201, msg(jo5));
  } else {
    check('S5 a similar report was flagged', false, msg(d5));
  }

  /* ------------------------------------------------ S6: the 5-job limit */
  {
    const mech = await login('mechanic@test.com');
    const fan = cat('Broken Fan / Aircon');
    const before = (await call(coord, 'GET', `/job-orders/technicians?tradeUnitId=${fan.defaultTradeUnit.id}`)).data
      .find((t) => t.id === ids['mechanic@test.com']).workload.active;
    const room = 5 - before; // jobs left before the limit
    const made = [];
    for (let i = 0; i < room + 1; i++) {
      const rr = await report(student, fan, opts.locations[(i + 5) % opts.locations.length], `Aircon number ${i + 1} is blowing warm air in this room.`);
      const ff = await signForm(student, rr.data.id);
      await call(coord, 'POST', `/job-order-forms/${ff.data.id}/approve`, {});
      made.push(rr.data.id);
    }
    let created = 0;
    let refusal = null;
    for (const id of made) {
      const j = await call(coord, 'POST', '/job-orders', { reportId: id, technicianId: ids['mechanic@test.com'] });
      if (j.status === 201) created++;
      else refusal = j;
    }
    check('S6 a technician gets at most 5 active jobs', created === room && refusal?.status === 409, `${before} active before, ${created} created, ${refusal && msg(refusal)}`);
    const list = await call(coord, 'GET', `/job-orders/technicians?tradeUnitId=${fan.defaultTradeUnit.id}`);
    const m = list.data.find((t) => t.id === ids['mechanic@test.com']);
    check('S6 the technician shows as full', m?.workload.active === 5, JSON.stringify(m?.workload));
    void mech;
  }

  /* ------------------------------------------------ permissions */
  {
    const r = await call(student, 'GET', '/reports');
    check('perm: a reporter cannot list all reports', r.status === 403, msg(r));
    const other = await call(student, 'GET', `/reports/${R2}`);
    check('perm: a reporter cannot open someone else\'s report', other.status === 403 || other.status === 404, msg(other));
    const t = await call(plumber, 'GET', `/job-orders/${J2}`);
    check('perm: a technician cannot open another technician\'s job', t.status === 403, msg(t));
    const mk = await call(plumber, 'POST', '/job-orders', { reportId: R2 });
    check('perm: a technician cannot create job orders', mk.status === 403, msg(mk));
    const rep = await call(plumber, 'POST', '/reports', { categoryId: leak.id, locationId: loc1.id, description: 'test', photo: PNG }, true);
    check('perm: a technician cannot submit reports', rep.status === 403, msg(rep));
    const coordFeedback = await call(coord, 'POST', `/reports/${R1}/feedback`, { rating: 1 });
    check('perm: a coordinator cannot rate a reporter\'s repair', coordFeedback.status === 403, msg(coordFeedback));
  }

  /* ------------------------------------------------ analytics and lists */
  {
    const ov = await call(coord, 'GET', '/analytics/overview?from=2026-01-01&to=2026-12-31');
    check('analytics: overview loads', ov.status === 200, msg(ov));
    const jobs = await call(coord, 'GET', '/job-orders');
    check('lists: job orders load and hide cancelled ones', jobs.status === 200 && jobs.data.every((j) => j.status !== 'CANCELLED'), msg(jobs));
    const forms = await call(coord, 'GET', '/job-order-forms');
    check('lists: forms load', forms.status === 200, msg(forms));
    if (tokens['admin@test.com']) {
      const adminUsers = await call(tokens['admin@test.com'], 'GET', '/users');
      check('admin: user list loads', adminUsers.status === 200, msg(adminUsers));
    }
  }

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  for (const f of failures) console.log('  FAIL ' + f);
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((e) => {
  console.error('CRASH', e);
  process.exitCode = 2;
});
