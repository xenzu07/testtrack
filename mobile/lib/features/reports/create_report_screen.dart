import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/api_client.dart';
import 'dart:typed_data';

class CreateReportScreen extends StatefulWidget {
  const CreateReportScreen({super.key});

  @override
  State<CreateReportScreen> createState() => _CreateReportScreenState();
}

class _CreateReportScreenState extends State<CreateReportScreen> {
  final descCtrl = TextEditingController();

  List<Map<String, dynamic>> locations = [];
  List<Map<String, dynamic>> categories = [];
  bool loading = true;
  bool submitting = false;
  String? loadError;

  String? building;
  String? floor;
  String? locationId;
  String? categoryId;
  // impact questions (used for the priority score; all three are required)
  int? affectedPeople; // 0 just me, 1 = 2-10, 2 = 11-50, 3 = more than 50
  bool? safetyHazard;
  bool? usable; // sent as blocksUse = !usable
  XFile? photo;
  Uint8List? photoBytes;

  @override
  void initState() {
    super.initState();
    descCtrl.addListener(() => setState(() {}));
    loadOptions();
  }

  @override
  void dispose() {
    descCtrl.dispose();
    super.dispose();
  }

  Future<void> loadOptions() async {
    setState(() {
      loading = true;
      loadError = null;
    });
    try {
      final res = await ApiClient.instance.dio.get('/reports/options');
      locations = List<Map<String, dynamic>>.from(res.data['locations']);
      categories = List<Map<String, dynamic>>.from(res.data['categories']);
    } catch (e) {
      loadError = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  // the server sends locations in natural order ("LR 5" before "LR 10");
  // toSet keeps that order, so the lists are not re-sorted here
  List<String> get buildings =>
      locations.map((l) => l['building'] as String).toSet().toList();

  List<String> get floors => locations
      .where((l) => l['building'] == building)
      .map((l) => l['floor'] as String)
      .toSet()
      .toList();

  List<Map<String, dynamic>> get rooms => locations
      .where((l) => l['building'] == building && l['floor'] == floor)
      .toList();

  String? get routedUnit {
    if (categoryId == null) return null;
    final c = categories.firstWhere((c) => c['id'] == categoryId);
    return c['defaultTradeUnit']?['name'];
  }

  bool get canSubmit =>
      !submitting &&
      locationId != null &&
      categoryId != null &&
      descCtrl.text.trim().length >= 5 &&
      affectedPeople != null &&
      safetyHazard != null &&
      usable != null &&
      photo != null;

  Future<void> pickPhoto(ImageSource source) async {
    // resizing and quality keep uploads small for campus bandwidth (mobile only)
    final x = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 70,
    );
    if (x == null) return;
    final bytes = await x.readAsBytes();
    setState(() {
      photo = x;
      photoBytes = bytes;
    });
  }

  Future<void> submit() async {
    if (photo == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('A photo is required.')));
      return;
    }
    setState(() => submitting = true);
    try {
      final isPng = photo!.name.toLowerCase().endsWith('.png');
      final ext = isPng ? 'png' : 'jpg';
      final mime = isPng ? 'image/png' : 'image/jpeg';
      final form = FormData.fromMap({
        'locationId': locationId,
        'categoryId': categoryId,
        'affectedPeople': affectedPeople,
        'safetyHazard': safetyHazard,
        'blocksUse': usable == null ? null : !usable!,
        'description': descCtrl.text.trim(),
        'photo': MultipartFile.fromBytes(
          photoBytes!,
          filename: 'photo.$ext',
          contentType: DioMediaType.parse(mime),
        ),
      });
      await ApiClient.instance.dio.post('/reports', data: form);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Report submitted.')));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(errorMessage(e))));
      setState(() => submitting = false);
    }
  }

  // one question with choice chips; the answers help decide which reports
  // are handled first
  Widget _question<T>(
    String label,
    List<(String, T)> options,
    T? value,
    ValueChanged<T> onChanged, {
    String? hint,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5, color: context.c.text)),
          if (hint != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(hint, style: TextStyle(color: context.c.muted, fontSize: 13)),
            ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              for (final o in options)
                ChoiceChip(
                  label: Text(o.$1),
                  selected: value == o.$2,
                  onSelected: submitting ? null : (_) => onChanged(o.$2),
                ),
            ],
          ),
          if (value == null)
            Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text('Required: choose one', style: TextStyle(color: context.c.muted, fontSize: 12.5)),
            ),
        ],
      ),
    );
  }

  InputDecoration _dec(String label) => InputDecoration(labelText: label);

  // long room names (e.g. "Department of Management Office Administration
  // Cluster") wrap to two lines instead of overflowing a narrow phone
  Widget _option(String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Text(text, maxLines: 2, overflow: TextOverflow.ellipsis),
      );

  // the closed field has room for one line: the chosen value is shown on one
  // line, shortened with "..." if needed (the open list keeps two lines)
  List<Widget> Function(BuildContext) _selected(List<String> labels) => (_) => [
        for (final l in labels)
          Align(
            alignment: Alignment.centerLeft,
            child: Text(l, maxLines: 1, overflow: TextOverflow.ellipsis, softWrap: false),
          ),
      ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New Report')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : loadError != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(loadError!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton(
                            onPressed: loadOptions, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                  children: [
                    SectionCard(
                      title: 'Where is it?',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    DropdownButtonFormField<String>(
                      value: building,
                      isExpanded: true,
                      itemHeight: null,
                      decoration: _dec('Building'),
                      selectedItemBuilder: _selected(buildings),
                      items: buildings
                          .map((b) => DropdownMenuItem(value: b, child: _option(b)))
                          .toList(),
                      onChanged: (v) => setState(() {
                        building = v;
                        floor = null;
                        locationId = null;
                      }),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      key: ValueKey('floor-$building'),
                      value: floor,
                      isExpanded: true,
                      itemHeight: null,
                      decoration: _dec('Floor'),
                      selectedItemBuilder: _selected(floors),
                      items: floors
                          .map((f) => DropdownMenuItem(value: f, child: _option(f)))
                          .toList(),
                      onChanged: building == null
                          ? null
                          : (v) => setState(() {
                                floor = v;
                                locationId = null;
                              }),
                    ),
                    SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      key: ValueKey('room-$building-$floor'),
                      value: locationId,
                      isExpanded: true,
                      itemHeight: null,
                      decoration: _dec('Room'),
                      selectedItemBuilder: _selected([for (final l in rooms) l['room'] as String]),
                      items: rooms
                          .map((l) => DropdownMenuItem(
                              value: l['id'] as String,
                              child: _option(l['room'] as String)))
                          .toList(),
                      onChanged: floor == null
                          ? null
                          : (v) => setState(() => locationId = v),
                    ),
                    // long room names are shortened in the field; the full
                    // place is spelled out here so the reporter can check it
                    if (locationId != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 8, left: 4),
                        child: Text(
                          '$building · $floor · ${rooms.firstWhere((l) => l['id'] == locationId, orElse: () => {'room': ''})['room']}',
                          style: TextStyle(color: context.c.muted, fontSize: 13),
                        ),
                      ),
                      ]),
                    ),
                    SectionCard(
                      title: "What's wrong?",
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    DropdownButtonFormField<String>(
                      value: categoryId,
                      isExpanded: true,
                      itemHeight: null,
                      decoration: _dec('Issue category'),
                      selectedItemBuilder: _selected([for (final c in categories) c['name'] as String]),
                      items: categories
                          .map((c) => DropdownMenuItem(
                              value: c['id'] as String,
                              child: _option(c['name'] as String)))
                          .toList(),
                      onChanged: (v) => setState(() => categoryId = v),
                    ),
                    if (routedUnit != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 6, left: 4),
                        child: Text('Will be routed to: $routedUnit',
                            style: TextStyle(color: context.c.muted)),
                      ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descCtrl,
                      maxLines: 4,
                      maxLength: 2000,
                      onChanged: (_) => setState(() {}),
                      decoration: _dec('Description')
                          .copyWith(
                              helperText: 'At least 5 characters',
                              hintMaxLines: 3,
                              hintText:
                                  'What is wrong, and since when? Example: Ceiling light flickers and buzzes'),
                    ),
                      ]),
                    ),
                    SectionCard(
                      title: 'Photo',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => pickPhoto(ImageSource.camera),
                            icon: const Icon(Icons.photo_camera),
                            label: const Text('Camera'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => pickPhoto(ImageSource.gallery),
                            icon: const Icon(Icons.photo_library),
                            label: const Text('Gallery'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (photo != null) ...[
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.memory(photoBytes!,
                            height: 200, fit: BoxFit.cover),
                      ),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: submitting
                              ? null
                              : () => setState(() {
                                    photo = null;
                                    photoBytes = null;
                                  }),
                          icon: Icon(Icons.delete_outline, size: 18),
                          label: const Text('Remove photo'),
                        ),
                      ),
                    ] else
                      Text('A photo is required so the team can see the problem.',
                          style: TextStyle(color: context.c.muted, fontSize: 13)),
                      ]),
                    ),
                    SectionCard(
                      title: 'How serious is it?',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Text('The system sets the priority from these answers, so the most serious problems are fixed first.', style: TextStyle(color: context.c.muted, fontSize: 13.5)),
                        const SizedBox(height: 14),
                    _question(
                      'How many people are affected?',
                      [
                        ('Just me', 0),
                        ('2 to 10', 1),
                        ('11 to 50', 2),
                        ('More than 50', 3),
                      ],
                      affectedPeople,
                      (v) => setState(() => affectedPeople = v),
                    ),
                    _question(
                      'Could someone get hurt because of this?',
                      [('Yes', true), ('No', false)],
                      safetyHazard,
                      (v) => setState(() => safetyHazard = v),
                      hint: 'For example exposed wires, a loose railing, a slippery floor.',
                    ),
                    _question(
                      'Can the room or facility still be used?',
                      [('Yes', true), ('No', false)],
                      usable,
                      (v) => setState(() => usable = v),
                    ),
                      ]),
                    ),
                    const SizedBox(height: 8),
                    FilledButton.icon(
                      onPressed: canSubmit ? submit : null,
                      icon: submitting
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.send),
                      label: const Text('Submit report'),
                    ),
                  ],
                ),
    );
  }
}