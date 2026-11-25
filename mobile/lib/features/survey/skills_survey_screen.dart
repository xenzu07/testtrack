import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/auth_provider.dart';

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
        'tasks': tasks.toList(),
      };
}

/// Skills survey. Shown automatically after a technician's first sign-in
/// ([required] = true: no back button, only sign out), and available later
/// from the account menu to update skills.
class SkillsSurveyScreen extends StatefulWidget {
  final bool required;
  const SkillsSurveyScreen({super.key, this.required = false});

  @override
  State<SkillsSurveyScreen> createState() => _SkillsSurveyScreenState();
}

class _SkillsSurveyScreenState extends State<SkillsSurveyScreen> {
  Map<String, dynamic>? survey;
  final Map<String, _UnitAnswer> answers = {};
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

  Future<void> submit() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Submit your skills?'),
        content: const Text(
            'Your answers decide which kinds of jobs you can be assigned. '
            'You can update them later from the account menu.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Review again')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Submit')),
        ],
      ),
    );
    if (ok != true) return;

    setState(() => submitting = true);
    try {
      final res = await ApiClient.instance.dio.post('/technicians/survey', data: {
        'answers': [
          for (final e in answers.entries) e.value.toJson(e.key),
        ],
      });
      if (!mounted) return;
      setState(() {
        results = res.data['results'] as List;
        submitting = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => submitting = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }

  // after the results screen: refresh the profile so the app knows the
  // survey is done (this also leaves the first-login gate)
  Future<void> finish() async {
    await context.read<AuthProvider>().refreshProfile();
    if (mounted && !widget.required) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !widget.required && !submitting,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: !widget.required,
          title: Text(results != null ? 'Your technical roles' : 'Skills survey'),
          actions: [
            const ThemeToggleButton(),
            if (widget.required)
              TextButton(
                onPressed: submitting ? null : context.read<AuthProvider>().logout,
                child: const Text('Sign out'),
              ),
          ],
        ),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? MessageView(
                    icon: Icons.cloud_off,
                    message: error!,
                    actionLabel: 'Retry',
                    onAction: load)
                : ReadableWidth(
                    child: results != null ? _results() : _form(),
                  ),
      ),
    );
  }

  Widget _form() {
    final s = survey!;
    final units = s['units'] as List;
    final levels = s['proficiencyLevels'] as List;
    final experience = s['experienceLevels'] as List;
    final answered = answers.values.where((a) => a.proficiency > 0).length;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Card(
          color: Theme.of(context).colorScheme.primaryContainer,
          margin: EdgeInsets.zero,
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              'Tell us what kinds of work you can do. For each trade, choose your '
              'skill level. If you do that work, a few more questions appear.\n\n'
              'Your answers decide which jobs the coordinator can assign to you. '
              'You can hold more than one role, for example Plumbing and Electrical.',
            ),
          ),
        ),
        const SizedBox(height: 16),
        for (final u in units)
          _UnitCard(
            name: u['name'] as String,
            tasks: List<Map<String, dynamic>>.from(
                (u['tasks'] as List).map((t) => Map<String, dynamic>.from(t))),
            levels: levels,
            experienceLevels: experience,
            answer: answers[u['id']]!,
            enabled: !submitting,
            onChanged: () => setState(() {}),
          ),
        const SizedBox(height: 8),
        Text(
          answered == 0
              ? 'You marked "None" for every trade. You will still receive jobs for your assigned trade unit.'
              : 'You do work in $answered trade${answered == 1 ? '' : 's'}.',
          style: TextStyle(color: context.c.muted),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: submitting ? null : submit,
          icon: submitting
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.check),
          label: const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text('Submit survey'),
          ),
        ),
      ],
    );
  }

  Widget _results() {
    final rules = survey!['rules'] as Map;
    final primary = survey!['status']?['primaryTradeUnit']?['name'] as String?;
    final sorted = [...results!]
      ..sort((a, b) => (b['score'] as num).compareTo(a['score'] as num));
    final qualified = sorted.where((r) => r['qualified'] == true).toList();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Icon(
          qualified.isEmpty ? Icons.info_outline : Icons.verified,
          size: 56,
          color: qualified.isEmpty ? context.c.muted : context.c.success,
        ),
        SizedBox(height: 8),
        Text(
          qualified.isEmpty
              ? 'No additional roles this time'
              : 'You qualify for ${qualified.length} role${qualified.length == 1 ? '' : 's'}',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 4),
        Text(
          [
            if (qualified.isNotEmpty)
              qualified.map((r) => r['name']).join(', '),
            if (primary != null)
              'You also keep receiving $primary jobs (your assigned trade unit).',
          ].join('\n'),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        Card(
          child: Column(children: [
            for (final r in sorted)
              ListTile(
                dense: true,
                leading: Icon(
                  r['qualified'] == true ? Icons.check_circle : Icons.remove_circle_outline,
                  color: r['qualified'] == true ? context.c.success : context.c.muted,
                ),
                title: Text(r['name'] as String),
                trailing: Text('${r['score']} / 100',
                    style: TextStyle(fontWeight: FontWeight.w600)),
              ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(
            'A role needs at least Intermediate skill and a score of '
            '${rules['minScore']} or more. The score combines skill level, '
            'experience, the tasks you can do and any formal training.',
            style: TextStyle(color: context.c.muted, fontSize: 12),
          ),
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: finish,
          child: const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text('Continue to my jobs'),
          ),
        ),
      ],
    );
  }
}

class _UnitCard extends StatelessWidget {
  final String name;
  final List<Map<String, dynamic>> tasks;
  final List<dynamic> levels;
  final List<dynamic> experienceLevels;
  final _UnitAnswer answer;
  final bool enabled;
  final VoidCallback onChanged;

  const _UnitCard({
    required this.name,
    required this.tasks,
    required this.levels,
    required this.experienceLevels,
    required this.answer,
    required this.enabled,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final a = answer;
    final level = levels[a.proficiency];
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text(name,
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              ),
              if (a.proficiency > 0)
                Pill(level['label'] as String, context.c.success),
            ]),
            SizedBox(height: 4),
            Text('How skilled are you in $name work?',
                style: TextStyle(color: context.c.muted)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final l in levels)
                  ChoiceChip(
                    label: Text(l['label'] as String),
                    selected: a.proficiency == l['value'],
                    onSelected: !enabled
                        ? null
                        : (_) {
                            a.proficiency = (l['value'] as num).toInt();
                            onChanged();
                          },
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(level['hint'] as String,
                  style: TextStyle(fontSize: 12, color: context.c.muted)),
            ),
            if (a.proficiency > 0) ...[
              const Divider(height: 24),
              const Text('Experience in this trade',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final e in experienceLevels)
                    ChoiceChip(
                      label: Text(e['label'] as String),
                      selected: a.experience == e['value'],
                      onSelected: !enabled
                          ? null
                          : (_) {
                              a.experience = (e['value'] as num).toInt();
                              onChanged();
                            },
                    ),
                ],
              ),
              if (tasks.isNotEmpty) ...[
                const SizedBox(height: 14),
                const Text('Which of these can you do on your own?',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                for (final t in tasks)
                  CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    value: a.tasks.contains(t['id']),
                    title: Text(t['label'] as String),
                    onChanged: !enabled
                        ? null
                        : (v) {
                            if (v == true) {
                              a.tasks.add(t['id'] as String);
                            } else {
                              a.tasks.remove(t['id']);
                            }
                            onChanged();
                          },
                  ),
              ],
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('I have formal training or a certificate in this trade'),
                subtitle: const Text('For example TESDA NC II, or a licence'),
                value: a.certified,
                onChanged: !enabled
                    ? null
                    : (v) {
                        a.certified = v;
                        onChanged();
                      },
              ),
            ],
          ],
        ),
      ),
    );
  }
}
