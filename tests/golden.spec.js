/* Golden tests for prototype v0.2, per spec §1.3.1: every mediation
   variant, the Emergency Measures cross-conditional, the hidden-answer
   rule, the three-arbitrators/Expedited override, and both modes. */
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, '..', 'prototype', 'index.html');
let failures = 0;
const check = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) failures++;
};

const BASE_3 = 'All disputes arising out of or in connection with the present contract shall be finally settled under the Rules of Arbitration of the International Chamber of Commerce by three arbitrators appointed in accordance with the said Rules.';

async function current_qid(page) {
  return page.locator('.screen.on .card[data-qid]').getAttribute('data-qid');
}
async function pick(page, label) {
  await page.locator('.screen.on .opt', { hasText: label }).first().click();
}
async function next(page) { await page.locator('#next_btn').click(); }

/* Walks the visible flow answering per the map {qid: {opt, select?, text?, amount?, days?}} */
async function walk(page, answers) {
  for (let guard = 0; guard < 20; guard++) {
    const qid = await current_qid(page);
    const a = answers[qid];
    if (!a) throw new Error('no scripted answer for visible question ' + qid);
    await pick(page, a.opt);
    if (a.select) await page.locator('.screen.on .opt-input select').first().selectOption({ label: a.select });
    if (a.text !== undefined) await page.locator('.screen.on .opt-input input[type=text]').fill(a.text);
    if (a.amount !== undefined) await page.locator('.screen.on .opt-input input[type=number]').fill(String(a.amount));
    if (a.days !== undefined) await page.locator('.screen.on .opt-input input[type=number]').fill(String(a.days));
    const is_last = (await page.locator('#next_btn').textContent()).includes('Review');
    await next(page);
    if (is_last) return;
  }
  throw new Error('walk did not terminate');
}

async function start(page, mode) {
  await page.goto(FILE);
  await page.locator('.screen.on a.btn.primary').first().click();
  await page.locator('.screen.on .opt', { hasText: mode }).click();
}

const ADV_BASE = {
  arbitrator_count: { opt: 'One arbitrator' },
  seat: { opt: 'Choose location', select: 'Geneva, Switzerland' },
  language: { opt: 'Select language', select: 'English' },
  governing_law_arb_agreement: { opt: 'Select applicable law', select: 'Swiss law' },
  confidentiality: { opt: 'Yes' },
  emergency_arbitrator: { opt: 'Keep default' },
  expedited_proceedings: { opt: 'Keep default' },
  document_production: { opt: 'No' },
  related_contracts: { opt: 'No' },
  multi_party: { opt: 'No' },
  mediation_include: { opt: 'No' }
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const console_errors = [];
  page.on('console', m => { if (m.type() === 'error') console_errors.push(m.text()); });
  page.on('pageerror', e => console_errors.push(String(e)));

  /* ---- G1: Simple mode, dont_know arbitrators, confidentiality default No ---- */
  await start(page, 'Keep it Simple');
  check('G1 simple has 4 steps', (await page.locator('.screen.on .progress').textContent()).includes('Step 1 of 4'));
  await walk(page, {
    arbitrator_count: { opt: "I don't know" },
    seat: { opt: 'Choose location', select: 'Geneva, Switzerland' },
    language: { opt: 'Select language', select: 'German' },
    confidentiality: { opt: 'No' }
  });
  let clause = await page.locator('.screen.on .clause').textContent();
  check('G1 default arbitrator wording', clause.includes('by one or more arbitrators appointed'));
  check('G1 seat Geneva (added by owner decision 31.07)', clause.includes('The place of arbitration shall be Geneva, Switzerland.'));
  check('G1 defaults summary shown (proposal)', (await page.locator('#scr_review').textContent()).includes('Left to defaults'));

  /* ---- G2: Advanced, sole arbitrator wording is "one arbitrator" (§4.1.1), custom threshold, doc production text ---- */
  await start(page, 'Advanced Mode');
  await walk(page, { ...ADV_BASE,
    arbitrator_count: { opt: 'One arbitrator' },
    seat: { opt: 'Other: Enter Location', text: 'Oslo, Norway' },
    expedited_proceedings: { opt: 'Custom threshold', amount: 3000000 },
    document_production: { opt: 'Yes' }
  });
  clause = await page.locator('.screen.on .clause').textContent();
  check('G2 "one arbitrator" not "a sole arbitrator" (§4.1.1)', clause.includes('by one arbitrator appointed') && !clause.includes('sole arbitrator appointed'));
  check('G2 threshold sentence with separator', clause.includes('does not exceed USD 3,000,000.'));
  check('G2 document production sentence (§4.2.4)', clause.includes('power to limit document production to what it considers necessary or appropriate.'));
  check('G2 seat free text', clause.includes('The place of arbitration shall be Oslo, Norway.'));
  check('G2 single clause paragraph', await page.locator('.screen.on .clause p.frag-p').count() === 1);

  /* ---- G3: Variant A: separate paragraph AFTER the clause (§5.3) ---- */
  await start(page, 'Advanced Mode');
  await walk(page, { ...ADV_BASE, mediation_include: { opt: 'Yes' }, mediation_type: { opt: 'Variant A. Optional' } });
  clause = await page.locator('.screen.on .clause').textContent();
  check('G3 A text present', clause.includes('Notwithstanding the foregoing, the parties may at any time'));
  check('G3 A comes AFTER the arbitration clause', clause.indexOf('All disputes arising') < clause.indexOf('Notwithstanding the foregoing'));
  check('G3 two paragraphs', await page.locator('.screen.on .clause p.frag-p').count() === 2);

  /* ---- G4: Variant B: separate paragraph BEFORE, no waiting question ---- */
  await start(page, 'Advanced Mode');
  await walk(page, { ...ADV_BASE, mediation_include: { opt: 'Yes' }, mediation_type: { opt: 'Variant B. Obligation to consider' } });
  clause = await page.locator('.screen.on .clause').textContent();
  check('G4 B text present and BEFORE', clause.indexOf('agree in the first instance to discuss and consider') < clause.indexOf('All disputes arising'));
  check('G4 base clause still present (B does not replace)', clause.includes('All disputes arising out of'));

  /* ---- G5: Variant C: BEFORE, and NO waiting-period question (§4.3.3) ---- */
  await start(page, 'Advanced Mode');
  await walk(page, { ...ADV_BASE, mediation_include: { opt: 'Yes' }, mediation_type: { opt: 'Variant C. Mandatory with parallel' } });
  check('G5 review reached without waiting question (C skips it)', (await page.locator('#scr_review h1').textContent()).includes('Review'));
  clause = await page.locator('.screen.on .clause').textContent();
  check('G5 C text present and BEFORE', clause.indexOf('shall first refer the dispute') < clause.indexOf('All disputes arising'));

  /* ---- G6: Variant D + EA default kept: integrated paragraph, rider present (§4.3.3, §5.3) ---- */
  await start(page, 'Advanced Mode');
  await walk(page, { ...ADV_BASE,
    arbitrator_count: { opt: 'Three arbitrators' },
    president_selection: { opt: 'Co-arbitrators jointly nominate' },
    mediation_include: { opt: 'Yes' },
    mediation_type: { opt: 'Variant D. Mandatory step' },
    mediation_waiting_period: { opt: '45 days (recommended)' }
  });
  clause = await page.locator('.screen.on .clause').textContent();
  check('G6 D replaces base (§5.3): no standalone base clause', !clause.includes('All disputes arising out of'));
  check('G6 D integrated text with 45 days and arbitrator wording',
    clause.includes('within 45 days following the filing of a Request for Mediation') &&
    clause.includes('shall thereafter be finally settled under the Rules of Arbitration of the International Chamber of Commerce by three arbitrators'));
  check('G6 EA rider present when not opted out (unanswered = default applies)',
    clause.includes('The 45-day mediation period shall not prevent applications for Emergency Measures'));
  check('G6 single integrated paragraph', await page.locator('.screen.on .clause p.frag-p').count() === 1);
  check('G6 president sentence absorbed into same paragraph', clause.includes('The co-arbitrators shall jointly nominate the president.'));

  /* ---- G7: Variant D + EA opt-out: rider ABSENT, opt-out sentence present ---- */
  await start(page, 'Advanced Mode');
  await walk(page, { ...ADV_BASE,
    emergency_arbitrator: { opt: 'Opt out' },
    mediation_include: { opt: 'Yes' },
    mediation_type: { opt: 'Variant D. Mandatory step' },
    mediation_waiting_period: { opt: 'Custom duration', days: 60 }
  });
  clause = await page.locator('.screen.on .clause').textContent();
  check('G7 rider omitted on EA opt-out', !clause.includes('shall not prevent applications for Emergency Measures'));
  check('G7 EA opt-out sentence present', clause.includes('The Emergency Arbitrator Provisions shall not apply.'));
  check('G7 custom 60-day period in D text', clause.includes('within 60 days following the filing'));

  /* ---- G8: three arbitrators + Expedited always: advisory + override fragment after expedited sentence (§4.2.3); document_production hidden ---- */
  await start(page, 'Advanced Mode');
  await walk(page, { ...ADV_BASE,
    arbitrator_count: { opt: 'Three arbitrators' },
    president_selection: { opt: 'ICC Court appoints' },
    expedited_proceedings: { opt: 'Always apply' },
    document_production: undefined,
    related_contracts: { opt: 'Yes' },
    multi_party: { opt: "I don't know" }
  });
  clause = await page.locator('.screen.on .clause').textContent();
  check('G8 override fragment present', clause.includes('Notwithstanding the application of the Expedited Procedure Provisions, the Court shall not have the power to appoint a sole arbitrator.'));
  check('G8 override sits after the expedited sentence (order 85)',
    clause.indexOf('irrespective of the amount in dispute.') < clause.indexOf('Notwithstanding the application'));
  check('G8 advisory shown for the tension (reworded 31.07 after owner decision)', clause.includes('may in principle appoint a sole arbitrator notwithstanding the arbitration agreement') && clause.includes('express stipulation preserving the three-member tribunal'));
  check('G8 related=Yes advisory (spec text)', clause.includes('Consider using consistent dispute resolution clauses'));
  check('G8 multi_party dont_know produces NO advisory (asymmetry §4.2.5/§4.2.6)', !clause.includes('non-signatories'));

  /* ---- G9: hidden-answer rule (§7.1): retained, removed from output, restored ---- */
  await start(page, 'Advanced Mode');
  await walk(page, { ...ADV_BASE,
    mediation_include: { opt: 'Yes' },
    mediation_type: { opt: 'Variant D. Mandatory step' },
    mediation_waiting_period: { opt: '45 days (recommended)' }
  });
  clause = await page.locator('.screen.on .clause').textContent();
  check('G9 setup: D active', !clause.includes('All disputes arising out of'));
  await page.locator('.screen.on a.edit', { hasText: 'edit' }).nth(0).click();  // jump somewhere in flow
  // navigate directly to mediation_include via the review edit link instead:
  await page.locator('.screen.on .card[data-qid]').waitFor();
  // jump straight using the app's own hook for determinism:
  await page.evaluate(() => jump_to('mediation_include'));
  await pick(page, 'No');
  clause = await page.locator('.screen.on .clause').textContent();
  check('G9 mediation text gone when include=No', !clause.includes('Request for Mediation') && clause.includes('All disputes arising out of'));
  await pick(page, 'Yes');
  clause = await page.locator('.screen.on .clause').textContent();
  check('G9 D restored with retained 45-day answer (retention, not deletion)',
    clause.includes('within 45 days following the filing') && !clause.includes('All disputes arising out of'));

  /* ---- G10: completeness gate (§7.1): copy disabled mid-flow, enabled at review; no placeholder syntax ever visible ---- */
  await start(page, 'Advanced Mode');
  await pick(page, 'Three arbitrators');
  check('G10 copy disabled mid-flow', await page.locator('.screen.on #copy_btn').isDisabled());
  const mid_clause = await page.locator('.screen.on .clause').textContent();
  check('G10 no raw placeholder syntax in preview', !/\{\w+\}/.test(mid_clause));
  await next(page);
  await pick(page, 'Co-arbitrators jointly nominate'); await next(page);
  await pick(page, 'Choose location');
  await page.locator('.screen.on .opt-input select').first().selectOption({ label: 'Frankfurt am Main, Germany' });
  await next(page);
  await pick(page, 'Select language');
  await page.locator('.screen.on .opt-input select').first().selectOption({ label: 'French' });
  await next(page);
  await pick(page, 'No'); await next(page);            // governing law: No
  await pick(page, "I don't know"); await next(page);  // confidentiality
  await pick(page, "I don't know"); await next(page);  // EA
  await pick(page, "I don't know"); await next(page);  // expedited
  await pick(page, "I don't know"); await next(page);  // document production
  await pick(page, "I don't know"); await next(page);  // related (warns)
  await pick(page, 'No'); await next(page);            // multi
  await pick(page, "I don't know"); await next(page);  // mediation -> review
  check('G10 review reached, copy enabled', !(await page.locator('.screen.on #copy_btn').isDisabled()));
  clause = await page.locator('.screen.on .clause').textContent();
  check('G10 related dont_know advisory (spec §4.2.5)', clause.includes('If related contracts exist, ensure dispute resolution clauses are compatible'));
  check('G10 base with three arbitrators (Frankfurt seat)', clause.includes(BASE_3.slice(0, 60)) && clause.includes('Frankfurt am Main, Germany.'));

  /* ---- review mode + German output ---- */
  await page.locator('#review_toggle').check();
  check('R chips visible in review mode', await page.locator('.screen.on .clause .chip').count() > 0);
  await page.locator('.screen.on .panel-ctls select').first().selectOption('de');
  check('R German output shows explicit pending notice', (await page.locator('.screen.on .clause').textContent()).includes('§7.4'));
  await page.locator('.screen.on .panel-ctls select').first().selectOption('en');
  await page.locator('#review_toggle').uncheck();

  /* ---- landing carries Annex C ---- */
  await page.goto(FILE);
  const landing = await page.locator('#scr_landing').textContent();
  check('L hero headline (C.1)', landing.includes('Build a tailored arbitration clause in minutes'));
  check('L problem/solution (C.2)', landing.includes("Don't let a bad clause start a second dispute"));
  check('L five benefits incl privacy (C.4)', landing.includes('Privacy focused'));
  check('L FAQ present with 7 items (C.5)', await page.locator('#scr_landing .faq-item').count() === 7);
  check('L final CTA (C.6)', landing.includes('Ready to build your arbitration agreement?'));

  check('no console or page errors across all goldens', console_errors.length === 0);
  if (console_errors.length) console.log(console_errors.slice(0, 6));

  await browser.close();
  console.log(failures === 0 ? '\nALL GOLDEN CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR: ' + e.message); process.exit(2); });
