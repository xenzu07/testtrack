import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'assignment_sheet.dart';
import '../../core/realtime.dart';

class JobDetailScreen extends StatefulWidget {
  final String jobId;
  const JobDetailScreen({super.key, required this.jobId});

  @override
  State<JobDetailScreen> createState() => _JobDetailScreenState();
}

class _JobDetailScreenState extends State<JobDetailScreen> {
  Map<String, dynamic>? job;
  bool loading = true;
  bool updating = false;
  // while in progress, only one of the two forms is shown at a time
  bool finishing = false;
  String? error;
  StreamSubscription<Map<String, dynamic>>? _sub;

  final startCtrl = TextEditingController();
  final progressCtrl = TextEditingController();
  final completeCtrl = TextEditingController();

  XFile? progressPhoto;
  Uint8List? progressBytes;
  XFile? completePhoto;
  Uint8List? completeBytes;

  @override
  void initState() {
    super.initState();
    load();
    _sub = Realtime.instance.events.listen((e) {
      if (mounted && e['jobOrderId'] == widget.jobId) load(silent: true);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    startCtrl.dispose();
    progressCtrl.dispose();
    completeCtrl.dispose();
    super.dispose();
  }

  Future<void> load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        loading = true;
        error = null;
      });
    }
    try {
      final res = await ApiClient.instance.dio.get('/job-orders/${widget.jobId}');
      job = Map<String, dynamic>.from(res.data);
      error = null;
    } catch (e) {
      if (!silent) error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<bool> _confirm(String title, String body) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Confirm')),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> pick(ImageSource source, {required bool forCompletion}) async {
    // resizing and quality keep uploads small for campus bandwidth
    final x = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 70,
    );
    if (x == null) return;
    final bytes = await x.readAsBytes();
    setState(() {
      if (forCompletion) {
        completePhoto = x;
        completeBytes = bytes;
      } else {
        progressPhoto = x;
        progressBytes = bytes;
      }
    });
  }

  // sends multipart form data to the status or progress endpoint
  Future<void> _send({
    required bool patch,
    required String path,
    required Map<String, dynamic> fields,
    required String successMessage,
    XFile? photo,
    Uint8List? bytes,
    VoidCallback? onSuccess,
  }) async {
    setState(() => updating = true);
    try {
      final map = <String, dynamic>{...fields};
      if (photo != null && bytes != null) {
        final isPng = photo.name.toLowerCase().endsWith('.png');
        map['photo'] = MultipartFile.fromBytes(
          bytes,
          filename: isPng ? 'photo.png' : 'photo.jpg',
          contentType: DioMediaType.parse(isPng ? 'image/png' : 'image/jpeg'),
        );
      }
      final form = FormData.fromMap(map);
      final dio = ApiClient.instance.dio;
      final res = patch
          ? await dio.patch(path, data: form)
          : await dio.post(path, data: form);
      job = Map<String, dynamic>.from(res.data);
      onSuccess?.call();
      _snack(successMessage);
    } catch (e) {
      _snack(errorMessage(e));
    }
    if (mounted) setState(() => updating = false);
  }

  Future<void> startWork() async {
    final ok = await _confirm('Start work',
        'Change this job to "In Progress"? This is recorded in the status history.');
    if (!ok) return;
    final remarks = startCtrl.text.trim();
    await _send(
      patch: true,
      path: '/job-orders/${widget.jobId}/status',
      fields: {
        'status': 'IN_PROGRESS',
        if (remarks.isNotEmpty) 'remarks': remarks,
      },
      successMessage: 'Work started.',
      onSuccess: startCtrl.clear,
    );
  }

  Future<void> postProgress() async {
    final remarks = progressCtrl.text.trim();
    if (remarks.length < 3) {
      _snack('Please describe the progress (at least 3 characters).');
      return;
    }
    await _send(
      patch: false,
      path: '/job-orders/${widget.jobId}/progress',
      fields: {'remarks': remarks},
      photo: progressPhoto,
      bytes: progressBytes,
      successMessage: 'Progress update posted.',
      onSuccess: () {
        progressCtrl.clear();
        progressPhoto = null;
        progressBytes = null;
      },
    );
  }

  Future<void> complete() async {
    if (completePhoto == null || completeBytes == null) {
      _snack('A photo of the completed work is required.');
      return;
    }
    final ok = await _confirm('Mark completed',
        'Mark this job as completed? The photo and remarks are recorded and this cannot be undone.');
    if (!ok) return;
    final remarks = completeCtrl.text.trim();
    await _send(
      patch: true,
      path: '/job-orders/${widget.jobId}/status',
      fields: {
        'status': 'COMPLETED',
        if (remarks.isNotEmpty) 'remarks': remarks,
      },
      photo: completePhoto,
      bytes: completeBytes,
      successMessage: 'Job marked as completed.',
      onSuccess: () {
        completeCtrl.clear();
        completePhoto = null;
        completeBytes = null;
      },
    );
  }

  String _ymd(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  // sends a JSON request and refreshes the job from the response
  Future<void> _json(
      String path, Map<String, dynamic> data, String successMessage) async {
    setState(() => updating = true);
    try {
      final res = await ApiClient.instance.dio.post(path, data: data);
      job = Map<String, dynamic>.from(res.data);
      _snack(successMessage);
    } catch (e) {
      _snack(errorMessage(e));
    }
    if (mounted) setState(() => updating = false);
  }

  Future<void> reportDelay() async {
    final reasonCtrl = TextEditingController();
    final materialsCtrl = TextEditingController();
    DateTime? revised;

    final submitted = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Report material delay'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: reasonCtrl,
                  maxLines: 2,
                  onChanged: (_) => setLocal(() {}),
                  decoration: const InputDecoration(
                    labelText: 'Reason for the delay',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: materialsCtrl,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Materials needed',
                    helperText: 'Optional',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () async {
                    final picked = await showDatePicker(
                      context: ctx,
                      initialDate: DateTime.now().add(const Duration(days: 7)),
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (picked != null) setLocal(() => revised = picked);
                  },
                  icon: const Icon(Icons.event),
                  label: Text(revised == null
                      ? 'Revised target date (optional)'
                      : _ymd(revised!)),
                ),
                if (revised != null)
                  TextButton(
                    onPressed: () => setLocal(() => revised = null),
                    child: const Text('Clear date'),
                  ),
                Text(
                  'Leave the date empty if none has been set yet.',
                  style: TextStyle(color: context.c.muted, fontSize: 12.5),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel')),
            FilledButton(
              onPressed: reasonCtrl.text.trim().length >= 3
                  ? () => Navigator.pop(ctx, true)
                  : null,
              child: const Text('Submit'),
            ),
          ],
        ),
      ),
    );
    if (submitted != true) return;

    final materials = materialsCtrl.text.trim();
    await _json(
      '/job-orders/${widget.jobId}/delay',
      {
        'reason': reasonCtrl.text.trim(),
        if (materials.isNotEmpty) 'materialsNote': materials,
        if (revised != null) 'revisedTargetDate': _ymd(revised!),
      },
      'Delay recorded.',
    );
  }

  Future<void> resumeWork() async {
    final noteCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Resume work'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Mark the delay as resolved and continue this job?'),
            const SizedBox(height: 12),
            TextField(
              controller: noteCtrl,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Remarks (optional)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Resume')),
        ],
      ),
    );
    if (ok != true) return;
    final note = noteCtrl.text.trim();
    await _json(
      '/job-orders/${widget.jobId}/resume',
      {if (note.isNotEmpty) 'remarks': note},
      'Work resumed.',
    );
  }

  String _delayText(Map<String, dynamic> j) {
    final delays = (j['delays'] as List?) ?? [];
    for (final d in delays) {
      if (d['resolvedAt'] == null) {
        final materials = d['materialsNote'];
        final revised = d['revisedTargetDate'];
        return 'Reason: ${d['reason']}'
            '${materials != null ? '\nMaterials: $materials' : ''}'
            '\nRevised target date: '
            '${revised != null ? formatDay(revised) : 'not yet set'}';
      }
    }
    return 'No details recorded.';
  }

  Widget _photoPicker({
    required Uint8List? bytes,
    required bool forCompletion,
    required String title,
    String? emptyHint,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: TextStyle(fontWeight: FontWeight.w600, color: context.c.text)),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: updating
                    ? null
                    : () => pick(ImageSource.camera, forCompletion: forCompletion),
                icon: const Icon(Icons.photo_camera),
                label: const Text('Camera'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: updating
                    ? null
                    : () => pick(ImageSource.gallery, forCompletion: forCompletion),
                icon: const Icon(Icons.photo_library),
                label: const Text('Gallery'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (bytes != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.memory(bytes, height: 160, fit: BoxFit.cover),
          )
        else if (emptyHint != null)
          Text(emptyHint, style: TextStyle(color: context.c.danger, fontSize: 13.5)),
      ],
    );
  }

  Widget _spinner() => const SizedBox(
      height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(job?['jobOrderNo'] ?? 'Job Order'),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text(error!, textAlign: TextAlign.center),
                      const SizedBox(height: 12),
                      FilledButton(onPressed: load, child: const Text('Retry')),
                    ]),
                  ),
                )
              : RefreshIndicator(onRefresh: load, child: ReadableWidth(child: _content())),
    );
  }

  Widget _content() {
    final c = context.c;
    final j = job!;
    final r = j['report'];
    final loc = r['location'];
    final photos = r['photos'] as List;
    final logs = r['logs'] as List;
    final status = j['status'] as String;
    final target = formatDay(j['targetDate']);
    final overdue = isOverdue(j);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(r['category']['name'], style: Theme.of(context).textTheme.titleLarge)),
          const SizedBox(width: 12),
          Padding(padding: const EdgeInsets.only(top: 5), child: StatusChip(status)),
        ]),
        const SizedBox(height: 4),
        Text('${loc['building']}, ${loc['floor']}, ${loc['room']}',
            style: TextStyle(color: c.muted, fontSize: 14.5)),
        const SizedBox(height: 10),
        Wrap(spacing: 10, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          PriorityPill(r['priority'] as String?),
          if (overdue) Pill('Overdue since $target', c.danger)
          else if (j['targetDate'] != null) Pill('Due $target', c.muted),
        ]),
        const SizedBox(height: 16),

        SectionCard(title: 'Next step', child: _actions(j, status)),

        SectionCard(
          title: 'The problem',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (photos.isNotEmpty) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.network(
                  AppConfig.mediaUrl(photos.first['storageUrl']) ?? '',
                  height: 200,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => Container(
                    height: 200,
                    color: c.hover,
                    alignment: Alignment.center,
                    child: Text('Photo could not be loaded', style: TextStyle(color: c.muted)),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            Text(r['description'], style: Theme.of(context).textTheme.bodyLarge),
          ]),
        ),
        SectionCard(
          title: 'Details',
          child: Column(children: [
            InfoRow('Job order', j['jobOrderNo']),
            InfoRow('Reported by', r['reporter']['fullName']),
            InfoRow('Trade unit', j['tradeUnit']['name']),
            InfoRow('Materials', j['materialsNote'] ?? 'Not specified'),
            InfoRow('Target date', target),
          ]),
        ),
        SectionCard(title: 'Status history', child: HistoryTimeline(logs)),
      ],
    );
  }

  // what the technician can do now, for the job's current state
  Widget _actions(Map<String, dynamic> j, String status) {
    final c = context.c;
    final delayLink = Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          onPressed: updating ? null : reportDelay,
          icon: const Icon(Icons.hourglass_bottom, size: 18),
          label: const Text('Waiting on materials? Report a delay'),
        ),
      ),
    );

    if (awaitingMyAnswer(j)) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Callout('Accept it to start work, or decline it with a reason.',
            title: 'This job was just assigned to you', kind: CalloutKind.success, icon: Icons.assignment_ind_outlined),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: updating
              ? null
              : () async {
                  final navigator = Navigator.of(context);
                  if (await showAssignmentSheet(context, j)) {
                    // a declined job is no longer mine: back to the list
                    await load(silent: true);
                    if (job == null || job!['technicianId'] == null) {
                      navigator.pop();
                    }
                  }
                },
          icon: const Icon(Icons.how_to_reg),
          label: const Text('Accept or decline'),
        ),
      ]);
    }

    switch (status) {
      case 'ASSIGNED':
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Let the coordinator know you have started.', style: TextStyle(color: c.muted, fontSize: 14)),
          const SizedBox(height: 12),
          TextField(
            controller: startCtrl,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'Remarks (optional)'),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: updating ? null : startWork,
            icon: updating ? _spinner() : const Icon(Icons.play_arrow),
            label: const Text('Start work'),
          ),
          delayLink,
        ]);
      case 'IN_PROGRESS':
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('Post update'), icon: Icon(Icons.edit_note)),
              ButtonSegment(value: true, label: Text('Finish job'), icon: Icon(Icons.check_circle_outline)),
            ],
            selected: {finishing},
            onSelectionChanged: (v) => setState(() => finishing = v.first),
          ),
          const SizedBox(height: 14),
          if (!finishing) ...[
            Text('Post as often as needed. The job stays in progress.',
                style: TextStyle(color: c.muted, fontSize: 14)),
            const SizedBox(height: 12),
            TextField(
              controller: progressCtrl,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Progress update',
                helperText: 'What was done, or what is still pending',
                helperMaxLines: 2,
                hintText: 'Example: Pipe removed, waiting for replacement fitting',
              ),
            ),
            const SizedBox(height: 12),
            _photoPicker(bytes: progressBytes, forCompletion: false, title: 'Photo (optional)'),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: updating ? null : postProgress,
              icon: updating ? _spinner() : const Icon(Icons.send),
              label: const Text('Post update'),
            ),
          ] else ...[
            Text('A photo of the finished work is required. The coordinator checks it before closing.',
                style: TextStyle(color: c.muted, fontSize: 14)),
            const SizedBox(height: 12),
            TextField(
              controller: completeCtrl,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Final remarks (optional)'),
            ),
            const SizedBox(height: 12),
            _photoPicker(
              bytes: completeBytes,
              forCompletion: true,
              title: 'Photo of the completed work',
              emptyHint: 'A completion photo is required.',
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: updating ? null : complete,
              icon: updating ? _spinner() : const Icon(Icons.check_circle),
              label: const Text('Mark completed'),
            ),
          ],
          delayLink,
        ]);
      case 'DELAYED':
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Callout(_delayText(j), title: 'This job is delayed', kind: CalloutKind.warn),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: updating ? null : resumeWork,
            icon: updating ? _spinner() : const Icon(Icons.play_arrow),
            label: const Text('Resume work'),
          ),
        ]);
      case 'CANCELLED':
        return Callout(
          'This was the same problem as another report, so the job was merged into '
          '${j['mergedInto']?['jobOrderNo'] ?? 'another job order'}.',
          title: 'No work needed',
        );
      case 'CLOSED':
        return const Callout('The coordinator verified and closed this job.',
            title: 'Closed', kind: CalloutKind.success);
      default:
        return const Callout('Waiting for the coordinator to verify the work.',
            title: 'Completed', kind: CalloutKind.success);
    }
  }
}
