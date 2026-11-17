import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/format.dart';
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
                    labelText: 'Materials needed (optional)',
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
                const Text(
                  'Leave the date empty if none has been set yet.',
                  style: TextStyle(color: Colors.grey, fontSize: 12),
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
            '${revised != null ? revised.toString().substring(0, 10) : 'not yet set'}';
      }
    }
    return 'No details recorded.';
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
                width: 110,
                child: Text(label, style: const TextStyle(color: Colors.grey))),
            Expanded(child: Text(value)),
          ],
        ),
      );

  Widget _photoPicker({
    required Uint8List? bytes,
    required bool forCompletion,
    required String title,
    String? emptyHint,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
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
          Text(emptyHint, style: const TextStyle(color: Colors.red)),
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
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: load)],
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
              : _content(),
    );
  }

  Widget _content() {
    final j = job!;
    final r = j['report'];
    final loc = r['location'];
    final photos = r['photos'] as List;
    final logs = r['logs'] as List;
    final status = j['status'] as String;
    final target = j['targetDate'] != null
        ? j['targetDate'].toString().substring(0, 10)
        : 'Not set';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (photos.isNotEmpty)
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(
              '${AppConfig.baseUrl}${photos.first['storageUrl']}',
              height: 220,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Container(
                height: 220,
                color: Colors.black12,
                alignment: Alignment.center,
                child: const Text('Photo could not be loaded'),
              ),
            ),
          ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Text(r['category']['name'],
                  style: Theme.of(context).textTheme.titleLarge),
            ),
            StatusChip(status),
          ],
        ),
        const SizedBox(height: 8),
        Text(r['description']),
        const Divider(height: 32),
        _row('Location', '${loc['building']}, ${loc['floor']}, ${loc['room']}'),
        _row('Urgency', urgencyLabel(r['urgency'])),
        _row('Reported by', r['reporter']['fullName']),
        _row('Trade unit', j['tradeUnit']['name']),
        _row('Materials', j['materialsNote'] ?? 'Not specified'),
        _row('Target date', target),
        const Divider(height: 32),

        if (status == 'ASSIGNED') ...[
          Text('Start the job', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: startCtrl,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'Remarks (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: updating ? null : startWork,
            icon: updating ? _spinner() : const Icon(Icons.play_arrow),
            label: const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Start work'),
            ),
          ),
        ] else if (status == 'IN_PROGRESS') ...[
          Text('Post a progress update',
              style: Theme.of(context).textTheme.titleMedium),
          const Text(
            'Use this as often as needed while the work continues. The job stays In Progress.',
            style: TextStyle(color: Colors.grey),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: progressCtrl,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'What was done or what is pending',
              hintText: 'Example: Pipe removed, waiting for replacement fitting',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          _photoPicker(
            bytes: progressBytes,
            forCompletion: false,
            title: 'Photo (optional)',
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: updating ? null : postProgress,
            icon: updating ? _spinner() : const Icon(Icons.add_comment),
            label: const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Post update'),
            ),
          ),
          const Divider(height: 40),
          Text('Finish the job', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: completeCtrl,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'Final remarks (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          _photoPicker(
            bytes: completeBytes,
            forCompletion: true,
            title: 'Photo of the completed work (required)',
            emptyHint: 'A completion photo is required.',
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: updating ? null : complete,
            icon: updating ? _spinner() : const Icon(Icons.check_circle),
            label: const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Mark completed'),
            ),
          ),
        ] else if (status == 'DELAYED') ...[
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.purple.withOpacity(0.08),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.purple.shade200),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('This job is delayed',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Text(_delayText(j)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: updating ? null : resumeWork,
            icon: updating ? _spinner() : const Icon(Icons.play_arrow),
            label: const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Resume work'),
            ),
          ),
        ] else
          Text(
            status == 'CLOSED'
                ? 'This job was verified and closed by the coordinator.'
                : 'Completed. Waiting for the coordinator to verify the work.',
            style: const TextStyle(color: Colors.green),
          ),

        if (status == 'ASSIGNED' || status == 'IN_PROGRESS') ...[
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: updating ? null : reportDelay,
            icon: const Icon(Icons.hourglass_bottom),
            label: const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Report material delay'),
            ),
          ),
        ],

        const Divider(height: 32),
        Text('Status history', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...logs.map((l) => HistoryTile(Map<String, dynamic>.from(l))),
      ],
    );
  }
}