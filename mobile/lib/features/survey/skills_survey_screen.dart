import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../auth/auth_provider.dart';
import '../tech/v2.dart';

/// One trade unit's answers while the survey is being filled in.
class _UnitAnswer {
  int proficiency = 0;
  int experience = 0;
  bool certified = false;
  final Set<String> tasks = {};

  Map<String, dynamic> toJson(String tradeUnitId) => {
        'tradeUnitId': tradeUnitId,
        'proficiency': proficiency,
        'experience': experience,
        'certified': certified,
        'tasks': proficiency == 0 ? <String>[] : tasks.toList(),
      };
}

/// Skills setup, one trade per screen. Shown automatically after a
/// technician's first sign-in ([required] = true: it cannot be skipped, only
/// signed out of), and later from Profile to update skills.
class SkillsSurveyScreen extends StatefulWidget {
  final bool required;
  const SkillsSurveyScreen({super.key, this.required = false});

  @override
  State<SkillsSurveyScreen> createState() => _SkillsSurveyScreenState();
}

class _SkillsSurveyScreenState extends State<SkillsSurveyScreen> {
  Map<String, dynamic>? survey;
  final Map<String, _UnitAnswer> answers = {};
  int step = 0;
  bool loading = true;
  bool submitting = false;
  String? error;
  List<dynamic>? results; // set after submitting

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final res = await ApiClient.instance.dio.get('/technicians/survey');
      final s = Map<String, dynamic>.from(res.data);
      answers.clear();
      for (final u in s['units'] as List) {
        answers[u['id'] as String] = _UnitAnswer();
      }
      // a retake starts from the previous answers
      final last = s['status']?['lastAnswers']?['units'] as List?;
      for (final a in last ?? const []) {
        final ua = answers[a['tradeUnitId']];
        if (ua == null) continue;
        ua.proficiency = (a['proficiency'] as num?)?.toInt() ?? 0;
        ua.experience = (a['experience'] as num?)?.toInt() ?? 0;
        ua.certified = a['certified'] == true;
        ua.tasks.addAll(List<String>.from(a['tasks'] as List? ?? const []));
      }
      survey = s;
    } catch (e) {
      error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  List get units => survey!['units'] as List;

  Future<void> submit() async {
    setState(() => submitting = true);
    try {
      final res = await ApiClient.instance.dio.post('/technicians/survey', data: {
        'answers': [for (final e in answers.entries) e.value.toJson(e.key)],
      });
      if (!mounted) return;
      setState(() {
        results = res.data['results'] as List;
        submitting = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => submitting = false);
      v2Snack(context, errorMessage(e));
    }
  }

  // refresh the profile so the app knows the survey is done (this also
  // leaves the first-login gate)
  Future<void> finish() async {
    await context.read<AuthProvider>().refreshProfile();
    if (mounted && !widget.required) Navigator.pop(context, true);
  }

  void back() {
    if (step > 0) {
      setState(() => step -= 1);
    } else if (!widget.required) {
      Navigator.pop(context);
    }
  }

  void next() {
    if (step < units.length - 1) {
      setState(() => step += 1);
    } else {
      submit();
    }
  }

  @override
  Widget build(BuildContext context) {
    return V2Scope(
      child: Builder(builder: (context) {
        final c = context.v;
        return PopScope(
          canPop: !submitting && results == null && step == 0 && !widget.required,
          onPopInvokedWithResult: (popped, _) {
            if (!popped && results == null && step > 0) back();
          },
          child: Scaffold(
            backgroundColor: c.bg,
            body: loading
                ? Center(child: CircularProgressIndicator(color: c.ac))
                : error != null
                    ? SafeArea(
                        child: MBody(top: 24, children: [
                          Note.text(error!, icon: V2Icons.alert),
                          V2Button('Try again', block: true, onPressed: load),
                        ]),
                      )
                    : results != null
                        ? _done()
                        : _step(),
            bottomNavigationBar: loading || error != null
                ? null
                : results != null
                    ? StickyBar(children: [
                        Expanded(
                          child: V2Button('Go to My Jobs', kind: BtnKind.pri, size: BtnSize.lg, block: true, onPressed: finish),
                        ),
                      ])
                    : StickyBar(children: [
                        if (step > 0)
                          SizedBox(
                            width: 110,
                            child: V2Button('Back', size: BtnSize.lg, block: true, onPressed: submitting ? null : back),
                          ),
                        Expanded(
                          child: V2Button(
                            step < units.length - 1 ? 'Next: ${units[step + 1]['name']}' : 'See my results',
                            kind: BtnKind.pri,
                            size: BtnSize.lg,
                            block: true,
                            busy: submitting,
                            onPressed: next,
                          ),
                        ),
                      ]),
          ),
        );
      }),
    );
  }

  Widget _top(String right, {bool showBack = true}) {
    final leading = showBack && (step > 0 || !widget.required)
        ? V2IconButton(V2Icons.back, tooltip: 'Back', plain: true, onPressed: submitting ? null : back)
        : widget.required
            ? V2IconButton(V2Icons.logout,
                tooltip: 'Sign out', plain: true, onPressed: () => context.read<AuthProvider>().logout())
            : const SizedBox(width: 40);
    return MTop(padding: const EdgeInsets.fromLTRB(20, 18, 20, 6), children: [
      leading,
      Expanded(
        child: Text('Skills Setup',
            textAlign: TextAlign.center, style: v2Text(size: 16, weight: FontWeight.w700, color: context.v.tx)),
      ),
      SizedBox(width: 40, child: Meta(right, align: TextAlign.right)),
    ]);
  }

  Widget _step() {
    final s = survey!;
    final u = units[step] as Map;
    final a = answers[u['id']]!;
    final levels = s['proficiencyLevels'] as List;
    final experience = s['experienceLevels'] as List;
    final tasks = (u['tasks'] as List).cast<Map>();

    return Column(children: [
      _top('${step + 1}/${units.length}'),
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 18),
        child: StepBars(total: units.length, done: step + 1),
      ),
      Expanded(
        // keyed by step: each trade opens at the top of its questions
        child: MBody(key: ValueKey(step), bottom: 24, children: [
          Row(children: [
            IconSquare.trade(u['name'] as String),
            const SizedBox(width: 12),
            Expanded(child: H1(u['name'] as String, size: 22)),
          ]),
          V2Field('How skilled are you?',
              child: CardRows([
                for (final l in levels)
                  _Pick(
                    title: l['label'] as String,
                    hint: l['hint'] as String?,
                    on: a.proficiency == l['value'],
                    radio: true,
                    onTap: () => setState(() => a.proficiency = (l['value'] as num).toInt()),
                  ),
              ])),
          if (a.proficiency > 0) ...[
            if (tasks.isNotEmpty)
              V2Field('Tasks you can do on your own',
                  child: CardRows([
                    for (final t in tasks)
                      _Pick(
                        title: t['label'] as String,
                        light: true,
                        on: a.tasks.contains(t['id']),
                        onTap: () => setState(() {
                          if (!a.tasks.remove(t['id'])) a.tasks.add(t['id'] as String);
                        }),
                      ),
                  ])),
            V2Field('How long have you done this work?',
                child: CardRows([
                  for (final e in experience)
                    _Pick(
                      title: e['label'] as String,
                      light: true,
                      radio: true,
                      on: a.experience == e['value'],
                      onTap: () => setState(() => a.experience = (e['value'] as num).toInt()),
                    ),
                ])),
            CardRows([
              _Pick(
                title: 'I have a certificate or formal training',
                hint: 'For example TESDA NC II, or a licence',
                on: a.certified,
                onTap: () => setState(() => a.certified = !a.certified),
              ),
            ]),
          ],
        ]),
      ),
    ]);
  }

  Widget _done() {
    final c = context.v;
    final s = survey!;
    final minScore = s['rules']?['minScore'] ?? 50;
    final levels = s['proficiencyLevels'] as List;
    final first = (context.read<AuthProvider>().user?.fullName ?? '').trim().split(' ').first;
    final byName = {for (final u in units) u['name']: answers[u['id']]};
    final rows = [...results!]
      ..retainWhere((r) => r['qualified'] == true || (byName[r['name']]?.proficiency ?? 0) > 0)
      ..sort((a, b) => (b['score'] as num).compareTo(a['score'] as num));
    final qualified = rows.where((r) => r['qualified'] == true).length;
    final primary = s['status']?['primaryTradeUnit']?['name'] as String?;

    return Column(children: [
      _top('Done', showBack: false),
      Expanded(
        child: MBody(top: 18, bottom: 24, children: [
          Column(children: [
            Container(
              width: 60,
              height: 60,
              decoration: BoxDecoration(color: c.acf, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: const V2Icon(V2Icons.check, size: 28, color: Colors.white),
            ),
            const SizedBox(height: 10),
            H1(first.isEmpty ? "You're all set" : "You're all set, $first", size: 24),
            const SizedBox(height: 10),
            Sub(
              qualified == 0
                  ? "You don't qualify for extra trades this time.${primary == null ? '' : ' You still get $primary jobs.'}"
                  : 'You qualify for $qualified trade${qualified == 1 ? '' : 's'}. The GSO can now offer you jobs in ${qualified == 1 ? 'it' : 'these'}.',
              align: TextAlign.center,
            ),
          ]),
          if (rows.isNotEmpty)
            MCard(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Column(children: [
                for (var i = 0; i < rows.length; i++)
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    decoration: BoxDecoration(border: i == 0 ? null : Border(top: BorderSide(color: c.line))),
                    child: Row(children: [
                      IconSquare.trade(rows[i]['name'] as String),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(rows[i]['name'] as String,
                              style: v2Text(size: 15, weight: FontWeight.w700, color: c.tx, height: 1.35)),
                          Meta([
                            levels[byName[rows[i]['name']]?.proficiency ?? 0]['label'],
                            if (rows[i]['qualified'] != true) 'below the $minScore needed',
                          ].join(' · ')),
                        ]),
                      ),
                      V2Tag('${rows[i]['score']} / 100',
                          tone: rows[i]['qualified'] == true ? TagTone.good : TagTone.neutral),
                    ]),
                  ),
              ]),
            ),
          Note.text('Change your answers any time in Profile, under Update my skills.', icon: V2Icons.info),
        ]),
      ),
    ]);
  }
}

/// A choice row (`.pick`): title, optional hint, radio or checkbox.
class _Pick extends StatelessWidget {
  final String title;
  final String? hint;
  final bool on;
  final bool radio;
  final bool light;
  final VoidCallback onTap;
  const _Pick({required this.title, this.hint, required this.on, this.radio = false, this.light = false, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.v;
    final marker = radio
        ? Container(
            width: 20,
            height: 20,
            decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: on ? c.acf : c.line2, width: 2)),
            alignment: Alignment.center,
            child: on
                ? Container(width: 10, height: 10, decoration: BoxDecoration(color: c.acf, shape: BoxShape.circle))
                : null,
          )
        : Container(
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: on ? c.acf : null,
              borderRadius: BorderRadius.circular(7),
              border: on ? null : Border.all(color: c.line2, width: 1.6),
            ),
            child: on ? const V2Icon(V2Icons.check, size: 14, color: Colors.white) : null,
          );
    return Semantics(
      checked: on,
      inMutuallyExclusiveGroup: radio,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title,
                    style: v2Text(size: 14, weight: light ? FontWeight.w500 : FontWeight.w700, color: c.tx, height: 1.4)),
                if (hint != null) Text(hint!, style: v2Text(size: 12, color: c.tx3, height: 1.4)),
              ]),
            ),
            const SizedBox(width: 12),
            marker,
          ]),
        ),
      ),
    );
  }
}
