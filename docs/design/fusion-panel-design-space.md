# Fusion Harnesses: A Mechanism-Design Map for Coordinating Multiple AI Agents

## Executive finding

The central design problem is not how to make agents talk. It is how to create, preserve, test, and selectively combine **independent information**.

Human institutions that outperform individuals usually do at least one of five things:

1. expose the problem to genuinely different information or search paths;
2. make claims legible enough to challenge;
3. assign decision rights separately from proposal rights;
4. connect confidence or authority to an external track record; or
5. stop errors from propagating across boundaries.

The corresponding anti-pattern is a roomful of nominally different agents that share a model, prompt, retrieved context, and transcript, then converge through persuasive prose. Human experiments show that even mild social influence can reduce estimate diversity without improving group error, while recent multi-agent-LLM studies report that debate can make correct agents adopt incorrect answers and that majority voting often accounts for most of debate's gains.[^1][^2][^3] Consensus is therefore not evidence of independent agreement unless the harness can prove the independence of the paths that produced it.

This report treats a “fusion harness” as an orchestration layer that can launch model instances, isolate or disclose context selectively, assign roles and tools, record structured claims, run external checks, aggregate judgments, and decide whether to answer, escalate, or abstain. The default assumptions are a mixture of same-model and cross-model agents, tasks spanning research/coding/planning/forecasting, and a harness able to keep private state and execute tools. The patterns remain usable under weaker assumptions, but their expected value changes.

## 1. Design-space map

### 1.1 Nine coordination mechanisms

These are not mutually exclusive architectures. They are functional mechanisms that can be composed.

| Mechanism | What it preserves or creates | Typical human institutions | Natural decision rule | Principal danger |
|---|---|---|---|---|
| Independent diversity | Uncorrelated hypotheses, estimates, or solutions | blind parallel work, nominal groups, Delphi panels, juries before deliberation | median, plurality, scoring, shortlist | correlated errors disguised as a crowd |
| Competition or adversarial pressure | Search for counterexamples, deception, and weaknesses | courts, debate, red teams, war games, prize contests | judge/umpire, test result, dominance | rhetoric, polarization, strategic gaming |
| Cooperative synthesis | A solution assembled from complementary partial views | charrettes, interdisciplinary boards, councils | editor/facilitator judgment, integrative proposal | compromise artifact with no coherent theory |
| Iterative criticism and refinement | Error correction over versions | peer review, replication, registered reports, design reviews, M&M conferences | pass/revise/reject; replicated/not replicated | endless review, deference, reviewer monoculture |
| Specialization and division of labor | Coverage of a problem too large for one mind | mission control, surgical teams, research labs, skilled trades | domain go/no-go plus integrator | brittle handoffs, local optimization, duplicated gaps |
| Consensus formation | Legitimacy and durable commitment | juries, Quaker meetings, Haudenosaunee councils, IETF working groups | unanimity, consent, rough consensus | conformity, veto abuse, lowest-common-denominator answers |
| Forecasting and uncertainty aggregation | Calibrated probability from dispersed signals | prediction markets, Delphi, weather ensembles, expert elicitation | market price, weighted pool, proper score | herding, thin participation, false precision |
| Hierarchical command | Fast coherent action under time pressure | incident command, military command, flight control, monastic rule | accountable commander decides | authority bias, suppressed local knowledge |
| Distributed/decentralized coordination | Local adaptation without global micromanagement | kanban/andon, mutual adjustment, federations, open technical communities | local pull/stop rules plus interface standards | inconsistent local state, integration debt |

### 1.2 The five control surfaces

Any concrete protocol can be described by five control surfaces:

**Information topology.** Are initial contexts sealed, partially shared, or fully shared? Do agents receive identical evidence, different evidence shards, or deliberately heterogeneous tools? Are author/model identities visible? Information isolation must be a harness property with auditable boundaries, not a sentence in an agent prompt.

**Work topology.** Is effort redundant (several agents solve the whole task), decomposed (specialists own subtasks), conditional (critics awaken only on flags), or evolutionary (many candidates compete for a small continuation budget)?

**Communication protocol.** One-shot submissions, anonymous rounds, sequential entry, pairwise cross-examination, a shared blackboard, hierarchical reporting, or broadcast deliberation each create different failure modes.

**Epistemic accounting.** Free prose is the weakest interface. Stronger interfaces distinguish claims, evidence, assumptions, uncertainty, provenance, falsifiers, dependencies, and predicted observations. Confidence should be scored for calibration, not treated as authority.

**Decision rights and stopping.** Fusion may mean mechanical aggregation, selecting an existing candidate, editing a new synthesis, vetoing unsafe actions, or escalating to a human. Fixed rounds are easy but often wasteful; evidence saturation, test completion, posterior stability, risk thresholds, and marginal-value estimates are better stopping signals.

### 1.3 A useful separation: generation, adjudication, and execution

A harness should normally separate three powers:

```text
private generation -> normalized claims/evidence -> challenge/verification
                   -> decision record + minority report -> execution gate
```

The generator should not silently choose the rubric. The synthesizer should not erase dissent. The judge should not see authorship or answer frequency unless those are intentionally part of the rule. The executor should receive a decision record, not an unrestricted transcript containing prompt injections or persuasive noise.

This resembles separation of powers more than a meeting. It also limits a known evaluator problem: LLM judges exhibit position, verbosity, and self-preference biases, so a single same-family judge is not a neutral oracle.[^4][^5]

## 2. What changes when the participants are AI agents

Human methods cannot be copied literally. Their useful mechanisms and their AI substitutions are:

| Human property | AI difference | Harness implication |
|---|---|---|
| Different biographies and private experience | Same-model agents share training, policy, and inductive biases | Create diversity with model families, prompts, tools, retrieval corpora, seeds, and problem representations; measure output correlation |
| Social status and authority gradients | Agents infer authority from wording, labels, verbosity, or majority signals | Anonymize sources, randomize order, hide vote counts, require itemized rebuttals |
| Costly effort and reputational stakes | More fluent text is cheap; role-played incentives may be cosmetic | Reward externally checkable discoveries, tests, calibrated forecasts, or unique evidence—not persuasiveness |
| Tacit knowledge | Models can produce plausible rationales not causally tied to answers | Score artifacts and predictions; do not equate chain-of-thought quality with correctness |
| Independent witnesses | Cloned agents may be statistically dependent | Estimate effective channel count; five correlated votes are not five votes |
| Deliberation can reveal private facts | Full transcripts also leak anchors, errors, and prompt injections | Use staged disclosure and structured claim exchange rather than transcript broadcast |
| Human fatigue and meeting cost | Tokens and latency still scale with agents × rounds × context | Route expensive patterns only when task value and uncertainty justify them |
| Consensus can create commitment | Agents need no emotional buy-in | Preserve dissent for epistemic value; do not spend tokens manufacturing unanimity |
| Expertise can be earned and socially recognized | Model self-confidence is often uncalibrated | Maintain task-specific empirical scorecards and calibrate on held-out “seed” questions |

Recent evidence makes the correlation issue concrete. Self-consistency improves several reasoning benchmarks by sampling multiple paths and marginalizing answers, but it does not guarantee independent errors.[^6] A 2026 study reports strong diminishing returns for homogeneous multi-agent scaling and larger gains from heterogeneous models, prompts, or tools; its finding should be treated as recent, not settled.[^7] Anthropic's experiments also found sycophancy across several assistants and linked it partly to preference optimization, reinforcing the need to prevent agents from reading a supposed consensus before committing their own view.[^8]

## 3. Method families and agent translations

Each entry marks historical description as **documented** and the proposed AI protocol as **design inference**.

### A. Independent diversity

#### A1. Blind parallel estimates and the “wisdom of crowds”

- **Human mechanism and problem — documented.** Individuals estimate or solve before communicating; an aggregate such as a median cancels some idiosyncratic error. It is designed for noisy estimation and choice where relevant information is dispersed. Lorenz et al.'s experiment is also the key warning: showing people others' estimates narrowed diversity and increased confidence without reliably improving collective error.[^1]
- **Roles, stages, communication, decision.** Identical question → sealed individual work → standardized answer/confidence → mechanical aggregate. There is no discussion before commitment.
- **Why it succeeds.** Errors that point in different directions cancel; the aggregate is less sensitive to one outlier.
- **Failure modes.** Shared priors or sources produce correlated errors; majority vote can bury a rare correct answer; duplicated effort is deliberate; aggregation is poor for open-ended designs; information cascades begin as soon as earlier answers are visible. Formal cascade models show how later actors can rationally ignore private signals after observing predecessors.[^9]
- **Agent protocol — design inference.** Launch 3–9 sealed agents with varied model/prompt/tool configurations. Require an answer, confidence, evidence references, and a short falsifier. Canonicalize equivalent answers before vote/median. Preserve the full candidate set for an oracle-gap analysis.
- **Harness enforcement.** No shared transcript or vote counts; independent random seeds; model/config provenance; correlation-aware weights; abstention; answer-order randomization.
- **Best / worst AI tasks.** Best for bounded questions, estimates, classification, math with a canonical answer, and candidate generation. Worst for tightly coupled systems, rare-expert facts absent from all contexts, and coherent long-form artifacts.

#### A2. Nominal group technique

- **Human mechanism and problem — documented.** Participants first generate ideas silently, then contribute them in a round-robin, clarify without advocacy, and privately rank priorities. It was developed to prevent dominant speakers and premature evaluation from suppressing problem identification and planning.[^10]
- **Roles, stages, communication, decision.** Facilitator; silent ideators; recorder; sequential idea listing; clarification; secret ranking. Ranked totals select priorities.
- **Why it succeeds.** Separating production from evaluation gives every member agenda access and creates an auditable option inventory.
- **Failure modes.** Similar participants still generate similar lists; clarification can smuggle advocacy; ranking favors broadly acceptable but mediocre options; the structured meeting has overhead.
- **Agent protocol — design inference.** All agents submit a fixed number of distinct proposals privately. The harness deduplicates semantically but retains provenance. Agents receive an anonymized option list, may ask factual clarification only, then score against a precommitted rubric.
- **Harness enforcement.** Phase gates; equal proposal quota; anonymous IDs; anti-duplication clustering; rubric fixed before options are shown; no free-form persuasion during scoring.
- **Best / worst AI tasks.** Best for requirements, risk lists, research questions, naming, feature ideation, and test generation. Worst when proposals are meaningful only as integrated wholes or require long interactive construction.

#### A3. Stepladder entry

- **Human mechanism and problem — documented.** Two members begin discussing after everyone first thinks independently. Additional members enter one at a time and present their ideas before hearing the group's current conclusion. In an original four-person experiment, stepladder groups outperformed conventional groups on a survival decision task.[^11]
- **Roles, stages, communication, decision.** Private preparation; a growing core; ordered entrants; final group choice.
- **Why it succeeds.** Late entrants retain fresh information and cannot merely echo a settled opening position.
- **Failure modes.** Early core still frames the debate; later agents may have too little influence; sequence matters; latency is linear.
- **Agent protocol — design inference.** Each agent commits a sealed answer. A two-agent core forms a draft. One new agent at a time sees only the task and its own commitment, states differences, then receives the current draft. The draft must log accepted/rejected deltas.
- **Harness enforcement.** Commit-before-read; randomized entry; change log; dissent retention; stop when two consecutive entrants add no new claim, evidence, or test.
- **Best / worst AI tasks.** Best for synthesis where fresh critique matters and a draft must remain coherent. Worst for urgent tasks or large swarms.

#### A4. Delphi panels

- **Human mechanism and problem — documented.** Experts answer anonymously in rounds; a facilitator returns statistical summaries and selected rationales; experts revise without face-to-face status pressure. RAND's early experiments framed Delphi as a method for group judgment under uncertainty.[^12]
- **Roles, stages, communication, decision.** Panelists; facilitator; repeated questionnaire; anonymous feedback; convergence, stable distribution, or round limit. Median and interquartile range are common outputs rather than forced unanimity.
- **Why it succeeds.** It combines revision with anonymity and gives extreme views a chance to contribute reasons without letting personalities dominate.
- **Failure modes.** Facilitator selection of feedback biases the panel; repeated medians anchor; convergence may be cosmetic; expert selection dominates results; slow rounds.
- **Agent protocol — design inference.** Agents submit probability distributions plus rationales. The harness returns anonymized distribution summaries and the most diagnostic pro/con evidence, not a single “group answer.” Revision requires a reason code: new evidence, corrected logic, or social update.
- **Harness enforcement.** Anonymous rounds; robust statistics; rationale sampling from both tails; calibration history; maximum rounds; convergence and unresolved-width stopping conditions.
- **Best / worst AI tasks.** Best for forecasts, uncertain estimates, policy scenarios, and requirement prioritization. Worst for externally verifiable tasks where running the test is cheaper than eliciting opinion.

### B. Competition and adversarial pressure

#### B1. Adversarial courts and cross-examination

- **Human mechanism and problem — documented.** Opposing parties develop their strongest cases under shared rules; witnesses and evidence are tested through cross-examination; a judge controls relevance, order, time, and harassment; a jury or judge decides. Federal Rule of Evidence 611 explicitly connects court control to truth-finding and avoiding wasted time.[^13]
- **Roles, stages, communication, decision.** Claimant, opponent, witnesses/evidence, judge, fact-finder; pleadings → evidence → direct examination → cross-examination → decision under a burden of proof.
- **Why it succeeds.** It gives a motivated party standing to search for weaknesses that a cooperative group may overlook, while procedure constrains the contest.
- **Failure modes.** Advocacy can optimize persuasion rather than truth; unequal capability/resources; binary framing excludes alternatives; polarization; the better rhetorician may win; excessive process.
- **Agent protocol — design inference.** A claimant submits atomic claims and evidence. An opposing agent may challenge admissibility, relevance, credibility, or inference. A neutral evidence clerk resolves source facts; the judge scores only the surviving record against an explicit burden.
- **Harness enforcement.** Symmetric budgets; fixed burdens; source citation and quotation limits; anonymous parties; claim-level rulings; judge blind to model identity; appeal on specified procedural errors.
- **Best / worst AI tasks.** Best for audit, safety cases, legal-like evidence disputes, architecture choices, and high-impact claims. Worst for broad creative exploration, underspecified values, and problems with many more than two live hypotheses.

#### B2. Red teams and devil's advocates

- **Human mechanism and problem — documented.** A protected team adopts the perspective of an adversary or attacks assumptions, vulnerabilities, and failure paths in a friendly plan. Army guidance emphasizes defined roles, focus on key vulnerabilities, plausible adversary actions, a facilitator/arbitrator, and improvement of the plan rather than argument for its own sake.[^14]
- **Roles, stages, communication, decision.** Blue plan; red challenge; controller/umpire; plan owner revises; accountable authority accepts risk.
- **Why it succeeds.** The institution gives dissent a job, budget, and legitimacy; it turns “being negative” into useful work.
- **Failure modes.** Ritual opposition, predictable critiques, red-team capture, performative hostility, endless edge cases, or blue-team defensiveness. A forced devil's advocate may produce arguments it does not actually believe.
- **Agent protocol — design inference.** Red receives the plan but not blue's internal reasoning. It must provide executable counterexamples, exploit paths, or falsification tests, ranked by impact × plausibility. Blue must answer each high-risk finding with mitigation, acceptance, or evidence of impossibility. Umpire verifies.
- **Harness enforcement.** Separate contexts; asymmetric objectives; exploit/test requirement; severity rubric; no “looks good” completion; residual-risk register; hard timebox.
- **Best / worst AI tasks.** Best for cybersecurity, plans, contracts, safety, policy abuse cases, and production readiness. Worst for simple factual questions and early ideation where criticism would freeze exploration.

#### B3. War-gaming and scenario play

- **Human mechanism and problem — documented.** Teams simulate action, reaction, and counteraction across plausible courses of action; controllers adjudicate effects and surface assumptions. Army planning guidance uses war-gaming to anticipate enemy responses and refine controls that reduce risk.[^14]
- **Roles, stages, communication, decision.** Blue, red, neutral control, sometimes green/civilian actors; scenario setup → turns → adjudication → branch/sequel analysis → plan revision. The commander selects a course of action.
- **Why it succeeds.** Dynamic interaction reveals second-order effects that static critique misses.
- **Failure modes.** Umpire bias; unrealistic adversary; game rules encode the conclusion; narrative seduction; combinatorial explosion; agents exploit simulator artifacts.
- **Agent protocol — design inference.** Encode state, objectives, action budget, observability, and adjudication rules. Run several seeded scenarios with red strategies drawn independently. Compare plans on regret, not just average outcome; mine failures into contingency triggers.
- **Harness enforcement.** Explicit state transitions; hidden information; multiple red policies; stochastic runs; adjudicator evidence; branch budget; ban retrospective rule changes.
- **Best / worst AI tasks.** Best for strategy, negotiations, incident response, rollout planning, and adversarial environments. Worst where the transition model is mostly invented or a direct real-world test is available.

### C. Cooperative synthesis

#### C1. Design charrettes

- **Human mechanism and problem — documented.** Interdisciplinary participants work rapidly, often in subgroups, on aspects or alternative solutions and repeatedly bring them together into a comprehensive design. The U.S. National Park Service describes charrettes as collaborative, time-bounded sessions that may split into subgroups and reconvene.[^15]
- **Roles, stages, communication, decision.** Sponsor/problem owner; facilitator; domain participants; sketch teams; review pin-ups; integrator. A design owner or sponsor selects and combines.
- **Why it succeeds.** External representations—sketches, maps, prototypes—let participants coordinate around an artifact rather than prose and expose interface conflicts early.
- **Failure modes.** Charismatic designer dominance; incoherent feature collage; solution fixation; aesthetics outrun evidence; high synchronization cost.
- **Agent protocol — design inference.** Parallel agents produce artifacts with declared assumptions and interfaces. A synthesis agent may only combine modules after interface tests and must name the governing concept, rejected alternatives, and unresolved contradictions.
- **Harness enforcement.** Shared artifact schema; independent first sketches; timed divergence/convergence; interface contracts; visual/testable prototypes; coherence review separate from feature voting.
- **Best / worst AI tasks.** Best for product design, architectures, curricula, research agendas, and complex documents. Worst for single-answer factual tasks or changes that cannot be modularized.

#### C2. Multidisciplinary case conference

- **Human mechanism and problem — documented by analogy.** Medicine brings specialists with different evidence and risk models around one case; surgical checklist practice adds mandatory pauses in which the whole team verbally confirms critical facts rather than relying on memory. WHO specifies three critical pauses and whole-team participation; the original multicenter study associated the checklist program with lower complications and deaths.[^16][^17]
- **Roles, stages, communication, decision.** Case owner; specialists; coordinator; shared record; differential/options; attending or patient makes the final decision.
- **Why it succeeds.** Complementary expertise covers blind spots, while a shared case record prevents basic facts from falling between specialties.
- **Failure modes.** Senior physician anchoring; specialist tunnel vision; diffusion of responsibility; duplicated testing; handoff loss; conference conclusions without ownership.
- **Agent protocol — design inference.** Specialists receive the same canonical case plus domain-specific tools. Each submits findings, contraindications, and unknowns. A coordinator merges the state; a mandatory “time-out” checks identity, objective, constraints, evidence freshness, and irreversible actions before execution.
- **Harness enforcement.** Domain ownership; common data model; explicit handoffs; contradiction detector; no execution until all required checks return; named owner for each unresolved risk.
- **Best / worst AI tasks.** Best for cross-domain research, migrations, complex debugging, and high-stakes action planning. Worst when roles are artificial and all agents have identical capability.

### D. Iterative criticism and refinement

#### D1. Peer review, registered reports, and replication

- **Human mechanism and problem — documented.** Peer review subjects methods and claims to expert criticism; registered reports review the question and method before results are known and grant in-principle acceptance based on rigor; independent replication tests whether a result survives a new team and run.[^18] The Open Science Collaboration's 100-study project illustrates why replication is a distinct information channel rather than a ceremonial second opinion.[^19]
- **Roles, stages, communication, decision.** Authors; editor; reviewers; independent replicators; preregistered protocol; revision; replicate/reject/qualify. Publication and truth are separate decisions.
- **Why it succeeds.** Precommitment prevents post-hoc story repair; reviewers improve design before sunk cost; replication exposes hidden dependencies and implementation mistakes.
- **Failure modes.** Reviewer consensus and prestige bias; publication incentives; replication using the same flawed materials; slow cycles; authors gaming metrics; “reviewed” mistaken for “true.”
- **Agent protocol — design inference.** Before solving, one agent writes a testable plan, expected outputs, and failure criteria. A methods reviewer critiques it blind to results. A producer executes. An independent replicator gets the task, plan, and public artifacts but not the producer's narrative, and uses a different model/tool chain when possible.
- **Harness enforcement.** Immutable preregistration hash; results-blind review; provenance; environment capture; independent tool/model path; discrepancy report; no silent post-hoc metric changes.
- **Best / worst AI tasks.** Best for research, coding, data analysis, migrations, and high-stakes factual claims. Worst for trivial tasks or subjective creative work lacking falsifiable criteria.

#### D2. Failure-mode analysis, premortems, and safety cases

- **Human mechanism and problem — documented.** FMEA decomposes a system into functions, possible failure modes, causes, effects, detection, and mitigation; NASA treats it as a living risk assessment performed alongside development.[^20]
- **Roles, stages, communication, decision.** Cross-functional owners; failure enumerators; risk assessors; control owners; review authority. Risks are prioritized by severity, occurrence/plausibility, and detectability, then closed or accepted.
- **Why it succeeds.** It reverses the default search direction: begin from failure and trace backward, making silent interfaces and common-mode risks visible.
- **Failure modes.** Huge tables, invented probabilities, checkbox compliance, correlated reviewers missing the same mode, low-frequency catastrophic risks washed out by multiplicative scores.
- **Agent protocol — design inference.** A failure-first agent receives only requirements and architecture, not the optimistic rationale. For every function it proposes failure → cause → observable symptom → consequence → test → mitigation. A common-mode specialist searches for one cause that defeats multiple agents or safeguards.
- **Harness enforcement.** Coverage map; severity floor; separate common-mode pass; evidence for closure; owner/deadline; no averaging away a catastrophic unresolved mode.
- **Best / worst AI tasks.** Best for systems, code, workflows, safety, compliance, and launch review. Worst for unconstrained ideation and low-consequence prose.

#### D3. Morbidity-and-mortality conference / after-action review

- **Human mechanism and problem — documented.** Teams reconstruct what was intended, what happened, why, and what should change. Army AAR guidance emphasizes candid multi-perspective discussion against standards; medical M&M conferences aim to learn from errors, though studies note that errors may be discussed too infrequently.[^21][^22]
- **Roles, stages, communication, decision.** Participants, facilitator, record keeper, action owner; timeline → contributing factors → counterfactuals → changes → follow-up.
- **Why it succeeds.** Outcome feedback updates the institution, not only the individual; near misses become training data.
- **Failure modes.** Blame, hindsight bias, sanitized narratives, vague lessons, no ownership, recurrence without measurement.
- **Agent protocol — design inference.** After each benchmark or production incident, replay decisions from logged state. Separate “known then” from “known now.” Agents identify local error, process error, and common-mode error; the harness turns only testable lessons into routing or protocol changes.
- **Harness enforcement.** Immutable event log; counterfactual replay; blameless language; evidence-linked lessons; action owner; regression test; expiry/revalidation of rules.
- **Best / worst AI tasks.** Best for long-running systems with repeated task classes. Worst for one-off tasks with no feedback.

### E. Specialization and division of labor

#### E1. Mission control and crew resource management

- **Human mechanism and problem — documented.** Mission control assigns consoles to subsystems under a flight director; key decisions use explicit go/no-go polls and prewritten flight rules. NASA describes the flight director as overseeing specialized controllers, while mission management polls technical teams at decision points.[^23] Aviation crew resource management emphasizes using all available people, equipment, and information, with open communication and assertion across authority gradients.[^24]
- **Roles, stages, communication, decision.** Domain controllers; integrator/flight director; single communication channel; criteria-based polls; commander decides.
- **Why it succeeds.** Specialization improves monitoring depth, standardized calls reduce ambiguity, and one accountable integrator prevents conflicting commands.
- **Failure modes.** Local “go” statuses hide system interactions; authority bias; channel bottlenecks; alert overload; specialists optimize their console rather than mission outcome.
- **Agent protocol — design inference.** Route work to capability-scored specialists. Each owns a bounded state slice and returns `GO`, `NO-GO`, or `GO WITH CONSTRAINT`, plus evidence and freshness. The director sees the global state but cannot overwrite a `NO-GO`; it must resolve, accept risk explicitly, or escalate.
- **Harness enforcement.** Typed reports; span-of-control limit; freshness timestamps; one owner per interface; decision criteria predeclared; concise exception-only communication; human gate for irreversible risk.
- **Best / worst AI tasks.** Best for large coding projects, operations, migrations, investigations, and tool-rich tasks. Worst for small indivisible questions where orchestration costs more than solving.

#### E2. Apprenticeship and master review

- **Human mechanism and problem — documented by broad tradition; protocol is inferential.** Skilled trades divide work by demonstrated competence: novices perform bounded tasks using exemplars, while masters inspect critical joins and retain sign-off authority. The mechanism addresses reliable skill transfer and safe delegation.
- **Roles, stages, communication, decision.** Master scopes and demonstrates; apprentice executes; journeyman checks; master signs off or returns work.
- **Why it succeeds.** Expensive expertise is concentrated at task definition and high-risk inspection rather than every action.
- **Failure modes.** Master bottleneck; inherited bad practice; novice hides uncertainty; review becomes rubber-stamping; little independent diversity.
- **Agent protocol — design inference.** A strong model decomposes and creates acceptance tests; cheaper agents execute bounded tickets; a separate verifier checks artifacts; the strong model handles only failed or high-risk joins.
- **Harness enforcement.** Capability registry from observed results; bounded permissions; examples/tests; escalation triggers; random audit even after pass; no self-signoff.
- **Best / worst AI tasks.** Best for scalable routine coding, extraction, classification, and document production. Worst for tasks whose hard part is decomposition or where cheap-agent errors are hard to detect.

### F. Consensus formation

#### F1. Jury deliberation

- **Human mechanism and problem — documented.** Jurors hear a bounded evidentiary record, apply a common legal standard, deliberate, and in U.S. federal criminal practice must reach unanimity. Model instructions emphasize that each juror decides for themselves, may change when persuaded, but should not surrender judgment merely because others disagree.[^25]
- **Roles, stages, communication, decision.** Judge/instructions; advocates/evidence; jurors; foreperson; private deliberation; unanimous or threshold verdict, otherwise hung jury.
- **Why it succeeds.** Diverse lay interpretation plus a demanding burden can reduce unilateral error and confer legitimacy.
- **Failure modes.** Group polarization, charismatic foreperson, compromise verdicts, hidden-profile failure, holdouts, social pressure. Human group research finds discussion often over-samples shared information and preference-consistent facts.[^26]
- **Agent protocol — design inference.** Sealed verdicts precede deliberation. Only disagreements and decisive evidence are disclosed. Each juror must file an individual post-deliberation verdict and change reason. A hung result triggers more evidence or escalation, not forced consensus.
- **Harness enforcement.** Evidence boundary; independent pre-vote; anonymous arguments; burden of proof; dissent right; maximum deliberation; hung/abstain state.
- **Best / worst AI tasks.** Best for consequential binary decisions, moderation appeals, test acceptance, and evidence-bounded diagnosis. Worst for creative generation and many-option optimization.

#### F2. IETF rough consensus and running code

- **Human mechanism and problem — documented.** The IETF does not reduce consensus to vote counts. RFC 7282 defines rough consensus as addressing technical objections, not necessarily accommodating each one, while implementations and interoperability evidence constrain elegant but untested preferences.[^27]
- **Roles, stages, communication, decision.** Contributors; document editor; working-group chair; implementers; objections; prototypes; chair calls consensus, subject to appeal.
- **Why it succeeds.** It prevents both 51% majoritarianism and single-person veto, and moves disputes from taste toward demonstrated consequences.
- **Failure modes.** Chair bias; endless recurring objections; incumbent implementation advantage; “running code” that is not representative; ugly compromises.
- **Agent protocol — design inference.** Agents submit objections in a structured form: requirement threatened, mechanism, evidence/test, severity. The chair may close an objection only with a recorded technical answer. Implementations/tests outrank raw vote count; unresolved material objections remain in the decision record.
- **Harness enforcement.** Objection ledger; no duplicate vote weighting; executable tests; chair separated from proposer; appeal; distinguish “addressed” from “agreed.”
- **Best / worst AI tasks.** Best for protocols, APIs, architecture, standards, and interoperable code. Worst for pure forecasts, aesthetics, or urgent incidents.

#### F3. Quaker “sense of the meeting” and deliberate silence

- **Human mechanism and problem — documented.** Quaker business meetings seek a shared “sense of the meeting” through communal discernment rather than majority voting; silence and pauses are part of the method, contentious matters may be laid over, and a member may stand aside while their disagreement is recorded.[^28]
- **Roles, stages, communication, decision.** Clerk/facilitator; participants; periods of silence; concise contributions; clerk proposes a minute; participants test whether it captures the sense; defer, stand aside, or unite.
- **Why it succeeds.** Slowness suppresses reactive turn-taking; the written minute becomes the object of agreement; standing aside distinguishes principled dissent from obstruction.
- **Failure modes.** Informal status remains; silence can conceal exclusion; long latency; ambiguous metaphysical legitimacy; pressure to appear spiritually unified.
- **Agent protocol — design inference.** After reading candidate claims, impose a no-communication reflection pass in which every agent privately lists what would change its mind and whether it has novel evidence. A clerk drafts a minimal decision minute. Agents may accept, object with a material test, or stand aside with a recorded minority note.
- **Harness enforcement.** Silent phase; one concise intervention per agent; materiality test for objections; defer option; immutable minority minute; prohibit claims that “everyone independently agrees” after shared exposure.
- **Best / worst AI tasks.** Best for value-sensitive policies, governance rules, and decisions where durable dissent records matter. Worst for emergencies and routine verifiable work.

#### F4. Haudenosaunee layered council

- **Human mechanism and problem — documented with cultural caution.** Haudenosaunee governance unites nations while preserving their internal councils. Confederacy materials describe chiefs accountable to clans, selected and removable by Clan Mothers, and a Grand Council with ordered consideration among national groups; Onondaga leaders may raise objections concerning consistency with the Great Law.[^29] This is a living political tradition, not a generic workshop technique.
- **Roles, stages, communication, decision.** Clan constituencies; chiefs as representatives; Clan Mothers with selection/accountability powers; ordered national “fires”; Onondaga keepers; consensus bounded by constitutional law.
- **Why it succeeds.** Representation, agenda flow, and constitutional review are separated; leaders are accountable to a constituency rather than owning their seat.
- **Failure modes.** Slow movement across layers; translation loss; gatekeeper capture; formal consensus can hide unequal inclusion. Extracting the form without its cultural and ethical context would be inappropriate.
- **Agent protocol — design inference.** Use only the abstract mechanism: independent caucuses evaluate a proposal, successive caucuses can amend but not erase prior objections, and a final constitutional-constraint agent checks invariants. Agent selectors/evaluators are separate from proposal agents.
- **Harness enforcement.** Layered state machine; constituency-specific rubrics; amendment provenance; constitutional veto limited to enumerated invariants; replace agents based on observed failure; respectful attribution.
- **Best / worst AI tasks.** Best for federated systems, multi-stakeholder policy, and requirements with non-negotiable constraints. Worst for simple tasks and contexts where the cultural analogy would substitute for engaging affected people.

#### F5. Benedictine full counsel with accountable final authority

- **Human mechanism and problem — documented.** Chapter 3 of the Rule of St. Benedict directs the abbot to call the whole community on weighty matters because insight may come from the younger member, then places the final decision and accountability on the abbot.[^30]
- **Roles, stages, communication, decision.** Whole community advises; junior and senior voices are heard; abbot decides under a governing rule and bears responsibility.
- **Why it succeeds.** Broad consultation captures peripheral knowledge without diffusing final accountability.
- **Failure modes.** Advice can be ceremonial; authority bias; obedience suppresses correction; the leader becomes a bottleneck.
- **Agent protocol — design inference.** For high-impact decisions, solicit one sealed view from every relevant specialist, including the cheapest/least-established agent before exposing the lead model's view. A commander agent decides but must cite each materially different submission and own an explicit risk statement.
- **Harness enforcement.** Junior-first disclosure; mandatory consultation coverage; decision rationale; dissent ledger; accountable signer; appeal for omitted evidence.
- **Best / worst AI tasks.** Best for time-bounded choices requiring broad input and one coherent action. Worst when the commander cannot be externally evaluated or when decentralized execution is safer.

#### F6. Deliberative polling and citizens' assemblies

- **Human mechanism and problem — documented.** Deliberative Polling draws a random representative sample, records baseline views, supplies balanced briefing materials, uses moderated small groups and questions to competing experts, then polls again.[^39] Ireland's Citizens' Assembly uses stratified random selection, repeated evidence sessions, deliberation, and votes on recommendations.[^40] These mechanisms address complex public choices where ordinary polls measure uninformed reaction and open meetings overrepresent organized participants.
- **Roles, stages, communication, decision.** Sortition/recruitment authority; representative participants; neutral secretariat; moderators; competing experts and stakeholders; baseline poll → learning → small-group deliberation → plenary questions → private final vote or recommendations. Elected institutions retain formal authority.
- **Why it succeeds.** Selection creates viewpoint coverage without requiring permanent experts; balanced time and information can expose participants to tradeoffs; pre/post measurement distinguishes deliberation from simple preference collection.
- **Failure modes.** Briefing authors and expert panels frame the option set; demographic representation does not ensure cognitive independence; small groups can polarize; the process is expensive; governments may ignore recommendations; “representative” agents cannot create democratic legitimacy.
- **Agent protocol — design inference.** For epistemic search only, sample a stratified panel across model families, tools, disciplines, risk attitudes, and problem framings. Record sealed baseline rankings, provide balanced evidence packets with adversarial source coverage, deliberate in small cells, then take anonymous post-deliberation rankings and explain changes.
- **Harness enforcement.** Stratification targets; information isolation for the baseline; symmetric evidence budgets; neutral moderation; secret pre/post votes; agenda provenance; separate factual findings from value choices; human decision rights whenever real stakeholders are affected.
- **Best / worst AI tasks.** Best for mapping policy options, stakeholder-relevant tradeoffs, and evidence-sensitive recommendations. Worst—and illegitimate—for substituting simulated agents for consent, representation, or decisions that belong to affected people.

### G. Forecasting and uncertainty aggregation

#### G1. Prediction markets and proper scoring

- **Human mechanism and problem — documented.** Participants buy or sell contracts tied to outcomes; prices aggregate willingness to risk resources on beliefs. Market scoring rules make continuous probability elicitation possible even with thin participation.[^31] Proper scoring rules such as the Brier score reward probabilistic accuracy over repeated resolved questions.[^32]
- **Roles, stages, communication, decision.** Traders; market maker; contract resolver; repeated trades; closing price or time-weighted price becomes the forecast.
- **Why it succeeds.** Participants can express intensity, update continuously, and profit from correcting a mistaken consensus.
- **Failure modes.** Thin markets, ambiguous resolution criteria, manipulation, correlated information, wealth/budget effects, no learning when events resolve late.
- **Agent protocol — design inference.** Give agents virtual budgets based on task-specific calibration. They trade probability mass on explicit outcomes and attach evidence to large moves. Payoffs update their future influence after resolution; a market maker ensures liquidity.
- **Harness enforcement.** Precise resolution rules; budget conservation; proper scores; position limits; identity separation; evidence log; no use for unresolvable normative questions.
- **Best / worst AI tasks.** Best for repeated forecasting, risk triage, timeline estimates, and test pass probabilities. Worst for one-off creative outputs or outcomes without objective resolution.

#### G2. Performance-weighted expert judgment and superforecasting

- **Human mechanism and problem — documented.** Cooke-style structured expert judgment uses calibration questions with known answers to measure statistical accuracy and informativeness, then constructs performance-weighted pools.[^33] In geopolitical forecasting experiments, probability training, team collaboration, and tracking high performers improved calibration and resolution.[^34]
- **Roles, stages, communication, decision.** Experts/forecasters; calibration-set designer; scorer; aggregator; repeated updates; performance-weighted probability.
- **Why it succeeds.** Influence is earned on observable task performance rather than status or confidence alone.
- **Failure modes.** Seed questions may not match the target; past performance decays; scoring can reward overfitting; elite grouping narrows diversity; rare events calibrate slowly.
- **Agent protocol — design inference.** Maintain capability vectors by domain, tool, horizon, and task form. Before a high-stakes estimate, give agents hidden matched seeds. Weight current forecasts by out-of-sample calibration and novelty, not self-reported certainty.
- **Harness enforcement.** Held-out rotating seeds; time-decayed weights; calibration curves; minimum diversity quota; equal-weight fallback when validation is weak.
- **Best / worst AI tasks.** Best for repeated estimates and domains with resolvable historical items. Worst for novel regimes and sparse outcome feedback.

### H. Hierarchical command

#### H1. Incident Command System and unified command

- **Human mechanism and problem — documented.** The Incident Command System provides common terminology, modular organization, manageable span of control, resource tracking, and unity of command. Unified Command lets agencies with different authority coordinate without surrendering their legal responsibilities.[^35]
- **Roles, stages, communication, decision.** Incident commander/unified command; operations, planning, logistics, finance; command staff; operational periods and incident action plans. Each person has one supervisor.
- **Why it succeeds.** Under pressure it reduces conflicting directives, makes ownership visible, and expands or contracts with the incident.
- **Failure modes.** Central bottleneck; stale situation reports; frontline signals filtered upward; bureaucracy applied to small incidents; authority suppresses specialist alarms.
- **Agent protocol — design inference.** Create a temporary org chart sized to task complexity. Planning maintains state and forecasts; operations executes; logistics manages tools/context; safety can halt; commander sets objectives and approves action. Replan at bounded operational periods.
- **Harness enforcement.** One reporting line; span-of-control cap; shared incident state; resource ledger; explicit objectives; safety stop; handoff protocol; demobilize roles when complexity falls.
- **Best / worst AI tasks.** Best for live incidents, multi-tool operations, migrations, and long-running autonomous work. Worst for brainstorming, small questions, and problems where central control creates a single point of failure.

### I. Distributed and decentralized coordination

#### I1. Toyota kanban, jidoka, and andon

- **Human mechanism and problem — documented.** Kanban makes downstream need pull upstream work; jidoka stops production when an abnormality appears; andon makes the problem and its location visible so help arrives before defects flow onward. Toyota documents stop-button-linked andons and the principle that defects should not be passed to the next process.[^36]
- **Roles, stages, communication, decision.** Local operator; downstream requester; visible board; supervisor/problem solver; pull token; stop signal; resume after correction.
- **Why it succeeds.** It localizes coordination, limits work in progress, and gives any worker power to prevent error propagation.
- **Failure modes.** Too many stops, hidden buffers, gaming metrics, local flow optimization, starvation, and treating alerts as noise.
- **Agent protocol — design inference.** Agents pull typed tasks from a shared blackboard only when capacity is free. Every artifact carries acceptance tests and provenance. Any consumer can raise an `ANDON` that freezes dependent propagation while leaving independent branches running.
- **Harness enforcement.** Work-in-progress limits; dependency graph; consumer-driven pull; stop-the-line permission; alert deduplication; root-cause owner; resume criteria; cache/reuse to prevent duplicated effort.
- **Best / worst AI tasks.** Best for pipelines, repositories, data processing, and distributed research with clear artifacts. Worst for tightly coupled real-time deliberation or problems without testable handoffs.

## 4. Cross-cutting failure modes and countermeasures

| Failure | Mechanism | Harness countermeasure |
|---|---|---|
| Groupthink / sycophancy | Agents infer agreement is rewarded | sealed first answers; anonymous claims; explicit dissent quota; no consensus reward |
| Authority bias | Model label, verbosity, or “lead agent” status substitutes for evidence | hide identities; junior-first order; itemized evidence; appeal path |
| Polarization | Roles become identities and arguments escalate | rotate roles; score discoveries not wins; allow synthesis only after factual rulings |
| Information cascade | Later agents copy visible early answers | commit-before-read; random order; disclose reasons without frequencies |
| Compromise answer | Synthesizer blends incompatible candidates | require governing theory and interface tests; selection allowed; do not force averaging |
| Hidden-profile failure | Shared facts dominate discussion over unique decisive facts | unique-evidence slots; diagnosticity scoring; query each agent for nonshared evidence |
| Duplicated effort | Parallelism repeats identical search | use redundancy only when independence is valuable; diversify tools/corpora; semantic dedup |
| Coordination overhead | Agents × rounds × transcript grows rapidly | task router; exception-only communication; adaptive stopping; cheap scouts before expensive agents |
| Correlated agent errors | Same model/data produces same confident mistake | heterogeneous channels; common-mode critic; effective-sample-size estimate; external tests |
| Judge bias | Evaluator prefers position, style, verbosity, or own family | shuffle order; blind authorship; pairwise rubric items; multiple judges; executable checks |
| Context leakage | Error, anchor, or prompt injection crosses agents | least-privilege context; typed messages; sanitize retrieved text; separate executor context |
| False confidence | Agreement or fluent rationale is mistaken for calibration | probability forecasts; calibration histories; answer-changing reasons; abstention |

## 5. Twelve concrete fusion-panel patterns

### Pattern 1 — Sealed Jury

**Protocol:** 5–9 agents answer independently with confidence, evidence, and falsifier. Normalize answers. Take a mechanical vote/median for bounded outputs; for open outputs, shortlist by rubric-blind pairwise judging. Reveal disagreement only after the pre-vote. A final juror vote may change only with a logged reason.

**Use:** Default high-value bounded reasoning. **Guard:** estimate effective rather than nominal voter count. **Stop:** stable aggregate plus no unresolved high-confidence minority evidence.

### Pattern 2 — Delphi Ladder

**Protocol:** Round 1 sealed distributions. Return median/range and anonymized rationales sampled from both tails. Round 2 revisions include reason codes. Continue only while new diagnostic evidence appears or interval width materially shrinks.

**Use:** Forecasts and estimates. **Guard:** never show model identities or a single authoritative “consensus.” **Stop:** two stable rounds, target interval width, or budget.

### Pattern 3 — ACH Evidence Matrix

**Protocol:** One agent generates mutually exclusive hypotheses; other agents independently add evidence and alternatives. Score each evidence item's consistency and diagnosticity across hypotheses. A falsifier attacks the leading hypothesis; the conclusion is the least-disconfirmed hypothesis plus sensitivity analysis, not the most eloquently supported one. This directly adapts the CIA's Analysis of Competing Hypotheses.[^37]

**Use:** Diagnosis, intelligence-style research, root-cause analysis. **Guard:** require missing hypotheses and deception/common-cause checks. **Stop:** ranking stable under reasonable evidence-weight perturbations.

### Pattern 4 — Red–Blue–Umpire

**Protocol:** Blue proposes; Red sees the artifact but not Blue's hidden rationale and produces executable attacks; a tool-backed Umpire rules claim by claim; Blue mitigates or explicitly accepts residual risks.

**Use:** Security, architecture, rollout plans. **Guard:** symmetrical budgets and external tests. **Stop:** no unresolved risk above threshold or human escalation.

### Pattern 5 — Registered Replication Lab

**Protocol:** Planner preregisters method, success metric, and failure criteria. Results-blind reviewer approves/revises. Producer executes. A differently configured replicator re-runs from public artifacts. Meta-review compares outcomes and reports discrepancies.

**Use:** Research, code, data transformations, high-stakes claims. **Guard:** immutable plan hash and environment capture. **Stop:** successful independent replication or explicit nonreplication.

### Pattern 6 — Mission Control Cells

**Protocol:** A director assigns typed subsystem ownership. Specialists send exception-only `GO/NO-GO/CONSTRAINED` reports with freshness and evidence. The director integrates; a safety role can halt; an action agent receives only approved instructions.

**Use:** Large decomposable tool tasks and incidents. **Guard:** one owner per interface and span-of-control limit. **Stop:** all critical consoles go or accepted risk is human-signed.

### Pattern 7 — Rough Consensus, Running Tests

**Protocol:** Proposals become implementations or testable specs. Objections must name a violated requirement and reproducible test. A chair closes objections only with technical dispositions; raw vote count is nonbinding. The minority report ships with the decision.

**Use:** APIs, standards, code architecture. **Guard:** chair cannot be proposal author. **Stop:** all material objections addressed, not necessarily agreed with.

### Pattern 8 — Calibrated Forecast Market

**Protocol:** Agents trade virtual probability shares with budgets derived from domain calibration. Large moves require evidence links. Outcomes settle under prewritten rules; scores update future budgets.

**Use:** Repeated forecasts and risk estimates. **Guard:** resolution clarity, position limits, time-decayed reputation. **Stop:** close time or price stability subject to minimum participation.

### Pattern 9 — Andon Blackboard *(unusual)*

**Protocol:** Agents pull work from a dependency board. Outputs are immutable versioned artifacts, not chat turns. Any downstream consumer can raise `ANDON(reason, evidence, affected_edges)`, freezing only dependent work. A root-cause cell repairs and revalidates before resumption.

**Use:** Long pipelines, repositories, distributed research. **Guard:** WIP limits and alert deduplication. **Stop:** board empty and no open andons.

### Pattern 10 — Silent Minute *(unusual)*

**Protocol:** After candidates are available, every agent performs a private silent pass: strongest objection, change-my-mind evidence, and preferred action. A clerk writes the shortest decision minute that addresses material objections. Agents accept, object with a test, or stand aside; stand-asides are preserved rather than argued away.

**Use:** Governance and value-laden decisions. **Guard:** do not claim independent consensus after shared exposure. **Stop:** accepted minute, principled stand-aside, or defer.

### Pattern 11 — Two-Fire Council *(unusual; culturally bounded inspiration)*

**Protocol:** Two or more stakeholder caucuses evaluate independently under different rubrics. Their amendments flow sequentially with full provenance. A separate constitutional keeper may veto only enumerated invariant violations. The final record includes each caucus's unresolved objection.

**Use:** Multi-stakeholder policies and federated systems. **Guard:** do not treat simulated agents as substitutes for affected humans; attribute the abstract inspiration respectfully. **Stop:** caucus consent plus invariant pass, or escalate.

### Pattern 12 — Failure-First Foundry *(unusual)*

**Protocol:** Before solution optimization, one team enumerates function → failure → cause → propagation → symptom → mitigation. A separate common-mode agent searches for single causes that defeat multiple safeguards. Only then do builders spend the main implementation budget.

**Use:** Safety-critical systems and irreversible workflows. **Guard:** catastrophic severity cannot be averaged away by low estimated frequency. **Stop:** every above-threshold failure is mitigated, tested, or explicitly accepted.

## 6. Comparative assessment of the strongest candidates

Scores are analytical judgments for a capable implementation, not empirical facts: **5 = favorable**, except latency and token cost where **5 = fast/cheap**, and correlated-error resistance where **5 = resistant**.

| Pattern | Quality | Diversity preservation | Factual reliability | Creativity | Robustness | Latency | Token economy | Scalability | Correlated-error resistance |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Sealed Jury | 4 | 5 | 4 | 3 | 3 | 5 | 4 | 5 | 2–4, configuration-dependent |
| Delphi Ladder | 4 | 4 | 3 | 3 | 3 | 3 | 3 | 4 | 3 |
| ACH Evidence Matrix | 4 | 4 | 5 | 2 | 5 | 3 | 3 | 3 | 4 with source diversity |
| Red–Blue–Umpire | 4 | 4 | 4 | 3 | 5 | 3 | 2 | 3 | 4 with tool-backed umpire |
| Registered Replication Lab | 5 | 5 | 5 | 2 | 5 | 1 | 1 | 2 | 5 if replication is truly independent |
| Mission Control Cells | 5 on decomposable tasks | 3 | 4 | 3 | 4 | 4 | 4 | 5 | 3 |
| Rough Consensus, Running Tests | 4 | 4 | 5 | 3 | 5 | 2 | 2 | 3 | 4 |
| Calibrated Forecast Market | 5 on forecasts | 4 | 4 | 1 | 4 | 4 | 5 | 5 | 3–4 |
| Andon Blackboard | 5 on pipelines | 4 | 4 | 3 | 5 | 4 | 4 | 5 | 4 |
| Silent Minute | 3 | 4 | 2 | 3 | 4 | 2 | 3 | 2 | 3 |
| Two-Fire Council | 4 | 5 | 3 | 3 | 5 | 2 | 2 | 3 | 4 |
| Failure-First Foundry | 4 | 4 | 4 | 3 | 5 | 3 | 3 | 3 | 5 for common-mode search |

No pattern dominates. Sealed Jury is a cheap diversity baseline; Registered Replication is the reliability ceiling for verifiable work; Mission Control and Andon win on decomposition; ACH wins on ambiguous diagnosis; markets win only when outcomes resolve; value conflicts need real stakeholders, not simulated consensus.

## 7. Prototype order

### Prototype first: four primitives, not four monoliths

1. **Sealed Jury + correlation telemetry.** It is simple, gives a strong baseline, and reveals whether the agent pool contains useful diversity at all. Implement independent contexts, structured answer/confidence/evidence, semantic answer normalization, and oracle-gap logging.
2. **ACH Evidence Matrix.** It changes the unit of exchange from prose to hypotheses and diagnostic evidence, making research and diagnosis auditable. It also supports selective retrieval and falsification without free-form debate.
3. **Red–Blue–Umpire with executable checks.** This tests whether critique adds value beyond best-of-N and whether tool-backed adjudication prevents persuasion failures.
4. **Andon Blackboard / Mission Control hybrid.** This is the most operationally useful pattern for coding and long-running tool work: specialization, typed handoffs, local stop authority, and limited context sharing.

Prototype **Registered Replication** next for high-stakes paths. Delay a full **Forecast Market** until there is a stream of resolvable tasks and enough outcome history to calibrate agents. Delay **Silent Minute** and **Two-Fire Council** until the product genuinely needs governance or multi-stakeholder legitimacy; agents must not impersonate absent stakeholders.

Naive free-form debate should be a control condition, not the default architecture. Original debate work reported gains on several reasoning tasks, but later work shows degradation and conformity in some settings and finds that pre-debate majority voting explains much of the improvement.[^2][^3][^38]

## 8. A modular meta-harness: MOSAIC

**MOSAIC — Mechanism-Oriented Selection, Adjudication, Isolation, and Control** treats coordination patterns as composable operators.

### 8.1 Intake profiler

For each task, estimate:

- **Verifiability:** external tests/source checks available?
- **Decomposability:** separable subtasks with typed interfaces?
- **Answer topology:** one correct answer, ranked options, coherent artifact, or value tradeoff?
- **Adversarial exposure:** deception, exploit, opponent, or distribution shift?
- **Uncertainty horizon:** will outcomes resolve and support calibration?
- **Stakes/reversibility:** cost of false positive/negative and action rollback?
- **Diversity need:** likelihood that one framing misses decisive information?
- **Time pressure:** hard latency and token budgets?
- **Human standing:** does the decision require affected people or legal authority?

The profiler returns scores and a confidence. Low-confidence routing uses the cheapest diversity-preserving baseline rather than pretending precision.

### 8.2 Pattern router

| Task signature | Primary mechanism | Optional overlay |
|---|---|---|
| bounded + verifiable | Sealed Jury | Registered Replication for high stakes |
| ambiguous diagnosis | ACH Matrix | Red–Blue falsifier |
| adversarial plan | Red–Blue–Umpire | War-game branches + Failure-First |
| large + decomposable | Mission Control Cells | Andon Blackboard |
| open-ended coherent artifact | Charrette-style parallel sketches | Stepladder synthesis + red review |
| repeated resolvable uncertainty | Forecast Market or calibrated pool | Delphi rationale rounds |
| standards/API | Rough Consensus, Running Tests | Sealed initial proposals |
| urgent incident | Incident Command / Mission Control | safety veto + fixed operational periods |
| value conflict / legitimacy | real human deliberative process | agents may brief evidence, not replace stakeholders |

### 8.3 Execution pipeline

```text
1. PROFILE
   classify task; define truth/utility target; set risk and budget

2. REGISTER
   freeze rubric, evidence policy, allowed tools, stopping rule, and decision rights

3. DIVERSIFY
   choose models/prompts/tools/corpora; estimate expected channel overlap

4. GENERATE SEALED
   collect independent candidates, hypotheses, forecasts, or decomposition plans

5. NORMALIZE
   extract atomic claims, evidence, assumptions, confidence, falsifiers, dependencies

6. ROUTE AND FUSE
   select/compose one or more patterns based on the profile

7. CHALLENGE
   invoke critics only on disputed, high-impact, low-evidence items

8. VERIFY
   prefer executable tests and source checks over more discussion

9. DECIDE
   mechanical aggregate, accountable judge, commander, or human authority

10. RECORD
    final artifact, provenance, confidence, rejected options, minority report, residual risks

11. LEARN
    on resolution, score agents and the routing decision; run an AAR on material failures
```

### 8.4 Enforced protocol objects

Every agent message should be typed rather than an unrestricted chat blob:

```yaml
claim_id: C17
claim: "..."
status: observed | documented | inferred | unknown
confidence: 0.0-1.0
evidence:
  - source_or_test: "..."
    supports: "..."
assumptions: ["..."]
falsifier: "What result would change this claim"
dependencies: [C3, C8]
novelty: new | confirms | contradicts | duplicates
requested_action: accept | test | revise | escalate | abstain
```

The harness, not the agent, supplies immutable author/configuration provenance. Agents see only the fields their role requires.

### 8.5 Stopping controller

Stop or escalate when the first applicable condition fires:

1. objective tests pass and no high-severity failure remains;
2. two iterations add no new diagnostic evidence, executable test, or material alternative;
3. candidate ranking is stable under judge-order swaps and plausible weighting changes;
4. posterior/forecast interval reaches its predeclared target;
5. expected value of another agent call falls below estimated cost;
6. time/token budget is reached;
7. a safety veto or unresolved material objection requires human authority;
8. no pattern has a legitimate decision rule for the value conflict—return the disagreement.

## 9. Evaluation program: does fusion beat the best individual?

### 9.1 Baselines that prevent misleading wins

Every experiment should compare the harness against:

- the **best individual model/configuration chosen ex ante**, not the average agent;
- the **same best model with the harness's total token/tool budget**;
- **best-of-N with an identical candidate pool**;
- **sealed majority/self-consistency** with no discussion;
- **naive debate + judge**;
- an **oracle selector** that chooses the best generated candidate, measuring how much value fusion leaves on the table.

The primary estimand is `harness quality − best-individual quality` at matched total cost. Secondary estimands separate **generation gain** (did the pool contain a better answer?) from **selection gain** (did fusion find it?) and **refinement gain** (did interaction improve it?).

### 9.2 Task strata

Use tasks with different coordination demands:

1. canonical-answer reasoning and math;
2. closed-book and source-grounded factual QA;
3. coding with hidden tests and repository-scale integration;
4. diagnosis with planted competing causes;
5. forecasting with historical cutoff and eventual resolution;
6. adversarial safety/security cases;
7. open-ended design scored by blinded humans plus constraint checks;
8. time-critical incident simulations;
9. multi-stakeholder cases where outcome is a disagreement map, not a fake objective answer.

### 9.3 Metrics

**Outcome:** exact accuracy, hidden-test pass rate, grounded-claim precision/recall, factual error severity, forecast Brier/log score, human utility, safety violations, and robustness under perturbation.

**Fusion-specific:** oracle gap, minority-correct recovery, harmful flip rate, answer correlation, effective channel count, unique-evidence recall, contradiction resolution, calibration, abstention quality, and common-mode failure rate.

**Cost:** tokens, tool calls, wall time, critical-path latency, dollar cost, context bytes disclosed, and coordinator-to-worker overhead.

**Process integrity:** independence violations, authorship leakage, judge order sensitivity, unsupported claim rate, unclosed `NO-GO`/andon alerts, and decision-record completeness.

### 9.4 Testable hypotheses

1. **Isolation hypothesis.** Sealed first passes increase oracle coverage and reduce harmful convergence relative to agents that share rationales from the start.
2. **Effective-channel hypothesis.** At fixed cost, heterogeneity in model family/tool/source produces more gain than additional homogeneous copies once output correlation crosses a task-specific threshold.
3. **Debate-conditionality hypothesis.** Debate improves results only when agents begin with material disagreement and can exchange checkable evidence; it harms recall-heavy tasks dominated by a wrong majority.
4. **Evidence-over-confidence hypothesis.** Weighting by source/test support and historical calibration beats raw self-confidence and rhetorical judge scores.
5. **Replication-independence hypothesis.** Replication catches materially more faults only when the replicator differs in model, tool chain, or problem representation; same-context replication mostly repeats errors.
6. **Specialization hypothesis.** Division of labor improves decomposable tasks but underperforms redundancy when interface uncertainty exceeds a measurable threshold.
7. **Minority-vault hypothesis.** Preserving and re-testing the strongest minority claim improves robustness under seeded majority error with little average-case cost.
8. **Adaptive-stopping hypothesis.** Evidence-saturation stopping matches or beats fixed-round quality at lower token cost and reduces late-round harmful flips.
9. **External-adjudication hypothesis.** Executable tests and primary-source checks capture more red-team value than an LLM judge reading adversarial prose.
10. **Routing hypothesis.** MOSAIC's task-conditioned routing beats any single pattern across a mixed benchmark, but only after routing overhead and profiler mistakes are counted.

### 9.5 Experiments

**Experiment A — Independence factorial.** Cross sealed/shared initial context × hidden/visible answer frequencies × same/heterogeneous models. Measure initial correlation, oracle coverage, harmful flips, and final accuracy.

**Experiment B — Debate decomposition.** Hold the candidate pool constant. Compare pre-debate vote, reasons-only exchange, cross-examination, free debate, and no-change judge selection. This isolates the value of communication from sampling.

**Experiment C — Planted minority truth.** Construct cases where one agent receives decisive valid evidence and the majority receives a plausible distractor. Measure whether each pattern recovers or suppresses the minority and whether it can distinguish a correct dissenter from a malicious one.

**Experiment D — Common-mode injection.** Seed the same false premise into all default contexts but give one configuration an independent corpus/tool. Test whether the router detects low effective diversity and whether the common-mode critic finds the shared premise.

**Experiment E — Judge audit.** Shuffle candidate order, strip style, equalize length, hide model identity, and cross judge families. Compare LLM verdicts with executable or human labels and quantify position/self-preference sensitivity.

**Experiment F — Handoff stress.** On repository tasks, vary subtask coupling and interface completeness. Compare one strong agent, Mission Control, and Andon Blackboard; measure duplicated edits, integration failures, and critical-path latency.

**Experiment G — Replication ablation.** Same-model/same-tool vs same-model/different-tool vs different-model/same-tool vs different-model/different-tool replication. Estimate which independence source buys the most defect detection per token.

**Experiment H — Forecast backtest.** Use historical questions with information cutoffs. Compare equal mean, median, Delphi, market scoring, and calibration-weighted aggregation on Brier score, calibration, and resolution.

**Experiment I — Stopping policy trial.** Fixed 1/2/4 rounds versus evidence-saturation and value-of-information stopping. Measure quality-cost Pareto frontiers and late-round regression.

**Experiment J — Router trial.** Train/select routing rules on one task set; lock them; evaluate on shifted task distributions. Report both task performance and regret versus the best per-task pattern.

### 9.6 Minimum viable success criterion

Do not call fusion successful merely because it beats the average worker. A credible first milestone is:

> On at least three distinct task strata, a preregistered harness beats the best ex-ante individual agent at matched total cost, with statistically bounded improvement, no material increase in severe errors, and positive results on a held-out task distribution.

Also report negative results. A router that reliably recognizes when **not** to invoke multiple agents may create more value than a universally active swarm.

## 10. Practical principles

1. Buy independent channels before buying more conversation.
2. Preserve first answers and minority evidence; never overwrite them with consensus.
3. Exchange claims, tests, and falsifiers rather than whole persuasive transcripts.
4. Use redundancy for uncertainty and specialization for scale; do not confuse them.
5. Let external reality—tests, sources, resolved outcomes—outvote eloquence.
6. Make proposal, synthesis, adjudication, and execution separate permissions.
7. Give local agents stop authority but global agents explicit decision accountability.
8. Calibrate influence on held-out performance, not self-confidence or model prestige.
9. Stop on evidence saturation or risk closure, not because the debate “feels complete.”
10. Treat disagreement as an output when the task has no legitimate machine decision rule.

## Sources

[^1]: Jan Lorenz, Heiko Rauhut, Frank Schweitzer, and Dirk Helbing, “[How Social Influence Can Undermine the Wisdom of Crowd Effect](https://pmc.ncbi.nlm.nih.gov/articles/PMC3107299/),” *PNAS* 108(22), 2011.
[^2]: Andrea Wynn, Harsh Satija, and Gillian Hadfield, “[Talk Isn't Always Cheap: Understanding Failure Modes in Multi-Agent Debate](https://arxiv.org/abs/2509.05396),” arXiv:2509.05396, 2025.
[^3]: Hyeong Kyu Choi, Xiaojin Zhu, and Yixuan Li, “[Debate or Vote: Which Yields Better Decisions in Multi-Agent Large Language Models?](https://openreview.net/pdf?id=iUjGNJzrF1),” 2025/2026 conference manuscript.
[^4]: Lianmin Zheng et al., “[Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://proceedings.neurips.cc/paper_files/paper/2023/file/91f18a1287b398d378ef22505bf41832-Paper-Datasets_and_Benchmarks.pdf),” NeurIPS 2023.
[^5]: Arjun Panickssery, Samuel R. Bowman, and Shi Feng, “[LLM Evaluators Recognize and Favor Their Own Generations](https://papers.neurips.cc/paper_files/paper/2024/file/7f1f0218e45f5414c79c0679633e47bc-Paper-Conference.pdf),” NeurIPS 2024.
[^6]: Xuezhi Wang et al., “[Self-Consistency Improves Chain of Thought Reasoning in Language Models](https://arxiv.org/abs/2203.11171),” ICLR 2023.
[^7]: Yingxuan Yang et al., “[Understanding Agent Scaling in LLM-Based Multi-Agent Systems via Diversity](https://arxiv.org/abs/2602.03794),” arXiv:2602.03794, 2026. Recent preprint; independent replication not established here.
[^8]: Mrinank Sharma et al., “[Towards Understanding Sycophancy in Language Models](https://www.anthropic.com/news/towards-understanding-sycophancy-in-language-models),” Anthropic research, 2023.
[^9]: Sushil Bikhchandani, David Hirshleifer, and Ivo Welch, “[A Theory of Fads, Fashion, Custom, and Cultural Change as Informational Cascades](https://www.journals.uchicago.edu/doi/10.1086/261849),” *Journal of Political Economy* 100(5), 1992.
[^10]: Andrew H. Van de Ven and André L. Delbecq, “[The Nominal Group as a Research Instrument for Exploratory Health Studies](https://pmc.ncbi.nlm.nih.gov/articles/PMC1530096/),” *American Journal of Public Health* 62(3), 1972; see also their 1971 group-process model.
[^11]: Steven G. Rogelberg, Janet L. Barnes-Farrell, and Charles A. Lowe, “[The Stepladder Technique: An Alternative Group Structure Facilitating Effective Group Decision Making](https://www.researchgate.net/publication/220027183_The_Stepladder_Technique_An_Alternative_Group_Structure_Facilitating_Effective_Group_Decision_Making),” *Journal of Applied Psychology* 77(5), 1992.
[^12]: Norman C. Dalkey, “[The Delphi Method: An Experimental Study of Group Opinion](https://www.rand.org/pubs/research_memoranda/RM5888.html),” RAND RM-5888-PR, 1969.
[^13]: Legal Information Institute, Cornell Law School, “[Federal Rule of Evidence 611: Mode and Order of Examining Witnesses and Presenting Evidence](https://www.law.cornell.edu/rules/fre/rule_611),” current rule and advisory notes.
[^14]: U.S. Army Center for Army Lessons Learned, “[First 100 Days, XO/S3 Handbook](https://api.army.mil/e2/c/downloads/2025/08/27/bdbd82e4/no-25-13-786-first-100-days-xo-s3-handbook.pdf),” No. 25-13 (786), 2025, section on red-teaming and war-gaming.
[^15]: U.S. National Park Service, “[Planning Catalog of Products & Services](https://www.nps.gov/orgs/1804/upload/CatalogofProducts_MAY2016_smallfile.pdf),” 2016, “Design Charrette.”
[^16]: World Health Organization, “[Safe Surgery Tools and Resources](https://www.who.int/teams/integrated-health-services/quality-of-care-and-patient-safety/patient-safety-guidance-and-tools/safe-surgery/tool-and-resources),” Surgical Safety Checklist guidance.
[^17]: Alex B. Haynes et al., “[A Surgical Safety Checklist to Reduce Morbidity and Mortality in a Global Population](https://www.nejm.org/doi/abs/10.1056/NEJMsa0810119),” *New England Journal of Medicine* 360, 2009.
[^18]: Center for Open Science, “[Registered Reports](https://www.cos.io/initiatives/registered-reports),” workflow and minimum features.
[^19]: Open Science Collaboration, “[Estimating the Reproducibility of Psychological Science](https://pubmed.ncbi.nlm.nih.gov/26315443/),” *Science* 349(6251), 2015.
[^20]: NASA Goddard Space Flight Center, “[Guideline for Failure Modes and Effects Analysis and Risk Assessment](https://standards.nasa.gov/node/12367),” GSFC-HDBK-8004, 2024.
[^21]: U.S. Army, “[Chaplain Corps ARNG Handbook 205](https://tjaglcs.army.mil/Portals/1003/TD%20Courses/c4rc/Chaplain%20Corps%20ARNG%20%20Handbook.pdf?ver=fHEnJa40wgv2zNc-SeujGg%3D%3D),” Appendix G, After-Action Review.
[^22]: AHRQ Patient Safety Network, “[A Descriptive Study of Morbidity and Mortality Conferences and Their Conformity to Medical Incident Analysis Models](https://psnet.ahrq.gov/issue/descriptive-study-morbidity-and-mortality-conferences-and-their-conformity-medical-incident),” 2010 study summary.
[^23]: NASA, “[JSC Mission Control Center](https://www.nasa.gov/johnson/jsc-mission-control-center/)” and “[Artemis I Mission Teams](https://www.nasa.gov/missions/artemis/orion/artemis-i-mission-teams-the-crew-behind-the-uncrewed-mission/),” role descriptions and decision polls.
[^24]: Federal Aviation Administration, “[Crew Resource Management Training](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_120-51C.pdf),” AC 120-51C, 1998; NASA, “[Cockpit Resource Management Training](https://ntrs.nasa.gov/search.jsp?R=19850009714),” 1984.
[^25]: U.S. Court of Appeals for the Ninth Circuit, “[Model Jury Instruction 6.19: Duty to Deliberate](https://www3.ce9.uscourts.gov/jury-instructions/node/898),” revised March 2024.
[^26]: Garold Stasser and William Titus, “[Pooling of Unshared Information in Group Decision Making: Biased Information Sampling During Discussion](https://cir.nii.ac.jp/crid/1360292619755398656),” *Journal of Personality and Social Psychology* 48(6), 1985.
[^27]: Pete Resnick, “[RFC 7282: On Consensus and Humming in the IETF](https://datatracker.ietf.org/doc/rfc7282/),” IETF, 2014.
[^28]: Quaker.org, “[What Is a Quaker Meeting for Business?](https://quaker.org/meeting-for-business/)” and “[Communal Discernment in Decision Making](https://quaker.org/decision-making/),” accessed 2026.
[^29]: Haudenosaunee Confederacy, “[Government](https://www.haudenosauneeconfederacy.com/government/)” and “[Who We Are](https://www.haudenosauneeconfederacy.com/who-we-are/),” descriptions of the living Confederacy's governance.
[^30]: Order of Saint Benedict, “[Rule of Benedict, Chapter 3: On Calling the Brethren for Counsel](https://www.archive.osb.org/rb/text/index.html),” Leonard Doyle translation.
[^31]: Robin Hanson, “[Logarithmic Market Scoring Rules for Modular Combinatorial Information Aggregation](https://hanson.gmu.edu/mktscore.pdf),” 2002 manuscript.
[^32]: Glenn W. Brier, “[Verification of Forecasts Expressed in Terms of Probability](https://journals.ametsoc.org/view/journals/mwre/78/1/1520-0493_1950_078_0001_vofeit_2_0_co_2.xml),” *Monthly Weather Review* 78, 1950.
[^33]: Roger Cooke, Max Mendel, and Wim Thijs, “[Calibration and Information in Expert Resolution: A Classical Approach](https://www.sciencedirect.com/science/article/pii/0005109888900118),” *Automatica* 24(1), 1988; Abigail Colson and Roger Cooke, “[Cross Validation for the Classical Model of Structured Expert Judgment](https://strathprints.strath.ac.uk/60136/),” 2017.
[^34]: Barbara Mellers et al., “[Psychological Strategies for Winning a Geopolitical Forecasting Tournament](https://journals.sagepub.com/doi/10.1177/0956797614524255),” *Psychological Science* 25(5), 2014.
[^35]: Federal Emergency Management Agency, “[National Incident Management System](https://training.fema.gov/programs/independent-study/coursematerials.aspx?code=IS-700.b),” 3rd ed., 2017; U.S. Fire Administration, “[NIMS Command and Coordination](https://www.usfa.fema.gov/a-z/nims/command-and-coordination.html),” 2026.
[^36]: Toyota Motor Corporation, “[Development and Deployment of the Toyota Production System](https://www.toyota-global.com/company/history_of_toyota/75years/text/entering_the_automotive_business/chapter1/section4/item4.html)” and “[Toyota Production System Timeline](https://www.toyota-global.com/company/history_of_toyota/75years/common/pdf/production_system.pdf),” 75-year history.
[^37]: Richards J. Heuer Jr., “[Psychology of Intelligence Analysis](https://www.cia.gov/resources/csi/books-monographs/psychology-of-intelligence-analysis-2/),” CIA Center for the Study of Intelligence, 1999, chapter on Analysis of Competing Hypotheses.
[^38]: Yilun Du et al., “[Improving Factuality and Reasoning in Language Models through Multiagent Debate](https://arxiv.org/abs/2305.14325),” ICML 2024.
[^39]: Stanford Deliberative Democracy Lab, “[What Is Deliberative Polling?](https://deliberation.stanford.edu/what-deliberative-pollingr),” process description.
[^40]: Citizens' Assembly of Ireland, “[Frequently Asked Questions](https://citizensassembly.ie/about/faq/),” selection, evidence, deliberation, and voting process.
