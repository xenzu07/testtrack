// A fake server for screen tests: answers the app's API calls with sample
// data, so the real screens can be rendered without a backend. The data is
// deliberately awkward: long building and room names, long names, every
// job and report state.
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:facilitrack_mobile/core/api_client.dart';

String _iso(Duration ago) => DateTime.now().subtract(ago).toUtc().toIso8601String();
String _day(int fromToday) {
  final n = DateTime.now().toUtc().add(Duration(days: fromToday));
  return DateTime.utc(n.year, n.month, n.day).toIso8601String();
}

const longPlace = {
  'id': 'loc1',
  'building': 'New Building',
  'floor': '3rd Floor',
  'room': 'Department of Management Entrepreneurship Cluster Faculty Room',
};
const shortPlace = {'id': 'loc2', 'building': 'Old Building', 'floor': '2nd Floor', 'room': 'Room 204'};

Map<String, dynamic> log(String? from, String to, Duration ago, [String? remarks]) =>
    {'oldStatus': from, 'newStatus': to, 'createdAt': _iso(ago), 'remarks': remarks, 'photoUrl': null};

Map<String, dynamic> report({
  String id = 'r1',
  String status = 'IN_PROGRESS',
  String category = 'Faulty Wiring / Outlet',
  Map place = longPlace,
  Map? form,
  Map? feedback,
  String urgency = 'CRITICAL',
}) =>
    {
      'id': id,
      'status': status,
      'urgency': urgency,
      'description':
          "Outlet near the teacher's table sparks when a plug is inserted. Burning smell since this morning, and the breaker trips twice a day.",
      'createdAt': _iso(const Duration(days: 3)),
      'category': {'id': 'c1', 'name': category},
      'location': place,
      'proposedTradeUnit': {'id': 'u1', 'name': 'Electrical'},
      'photos': <Map>[],
      'safetyHazard': true,
      'affectedPeople': 2,
      'blocksUse': true,
      'duplicateOfId': null,
      'duplicateOf': null,
      'reporter': {'id': 'rep', 'fullName': 'Maria Clara Santos-Dela Cruz', 'userType': 'student'},
      'jobOrder': status == 'SUBMITTED' || status == 'UNDER_REVIEW'
          ? null
          : {
              'id': 'j1',
              'jobOrderNo': 'JO-2026-0142',
              'status': status,
              'targetDate': _day(1),
              'materialsNote': '35µF run capacitor, two pieces',
              'technician': {'id': 't1', 'fullName': 'Ramon Cruz Villanueva'},
            },
      'jobOrderForm': form,
      'feedback': feedback,
      'logs': [
        log(null, 'SUBMITTED', const Duration(days: 3), 'Report submitted'),
        log('SUBMITTED', 'UNDER_REVIEW', const Duration(days: 3)),
        if (!['SUBMITTED', 'UNDER_REVIEW'].contains(status))
          log('UNDER_REVIEW', 'ASSIGNED', const Duration(days: 2), 'Sent to the Electrical team.'),
        if (['IN_PROGRESS', 'DELAYED', 'COMPLETED', 'CLOSED'].contains(status)) ...[
          log('ASSIGNED', 'IN_PROGRESS', const Duration(days: 2), 'Ramon is on site.'),
          log('IN_PROGRESS', 'IN_PROGRESS', const Duration(hours: 5),
              'Replacing the burnt outlet now. The cover plate is also cracked and needs a replacement part.'),
        ],
        if (status == 'DELAYED') log('IN_PROGRESS', 'DELAYED', const Duration(hours: 2), 'Waiting for materials: 35µF run capacitor'),
        if (['COMPLETED', 'CLOSED'].contains(status)) log('IN_PROGRESS', 'COMPLETED', const Duration(hours: 3), 'Replaced the outlet.'),
        if (status == 'CLOSED') log('COMPLETED', 'CLOSED', const Duration(hours: 1), 'Verified.'),
      ],
    };

Map<String, dynamic> job(String status, {String? answer, String id = 'j1', String category = 'Faulty Wiring / Outlet', String trade = 'Electrical'}) {
  final r = report(status: status, category: category);
  return {
    'id': id,
    'jobOrderNo': 'JO-2026-0142',
    'status': status,
    'assignmentStatus': answer ?? (status == 'ASSIGNED' ? 'ACCEPTED' : 'ACCEPTED'),
    'technicianId': 't1',
    'targetDate': _day(1),
    'materialsNote': '35µF run capacitor, two pieces',
    'createdAt': _iso(const Duration(days: 2)),
    'updatedAt': _iso(const Duration(minutes: 12)),
    'tradeUnit': {'id': 'u1', 'name': trade},
    'mergedInto': null,
    'delays': status == 'DELAYED'
        ? [
            {
              'id': 'd1',
              'reason': 'Waiting for materials',
              'materialsNote': 'Flush valve assembly, 1 pc, and two rubber gaskets',
              'revisedTargetDate': _day(3),
              'createdAt': _iso(const Duration(days: 1)),
              'resolvedAt': null,
            }
          ]
        : <Map>[],
    'report': {...r, 'priority': 'P1'},
  };
}

Map<String, dynamic> form({String status = 'APPROVED'}) => {
      'id': 'f1',
      'formNo': 'JOF-2026-0061',
      'status': status,
      'revision': 1,
      'reportId': 'r1',
      'urgency': 'CRITICAL',
      'categoryName': 'Faulty Wiring / Outlet',
      'locationText': 'New Building, 3rd Floor, Department of Management Entrepreneurship Cluster Faculty Room',
      'department': 'College of Engineering and Information Technology, BSIT 3-1',
      'contactNumber': '0917 123 4567',
      'preferredSchedule': 'Afternoons',
      'workRequested': 'Replace the sparking outlet near the teacher table.',
      'notes': null,
      'submittedAt': _iso(const Duration(days: 2)),
      'receivedAt': _iso(const Duration(days: 2)),
      'decidedAt': status == 'SUBMITTED' ? null : _iso(const Duration(days: 1)),
      'decisionNote': status == 'RETURNED'
          ? "Please add the section adviser's contact number and the exact room."
          : 'Scheduled for this afternoon.',
      'signedAt': _iso(const Duration(days: 2)),
      'integrityOk': true,
      'report': {'jobOrder': {'jobOrderNo': 'JO-2026-0142', 'status': 'IN_PROGRESS'}},
    };

final analytics = {
  'range': {'from': '2026-10-28', 'to': '2026-11-26', 'granularity': 'day'},
  'offers': {'total': 14, 'accepted': 13, 'declined': 1, 'waiting': 0, 'withdrawn': 0},
  'jobs': {
    'completed': 12,
    'active': 2,
    'acceptedInPeriod': 13,
    'completionRate': 0.92,
    'completionTime': {'medianHours': 33.6, 'avgHours': 40.1},
  },
  'series': {
    'keys': [for (var i = 0; i < 30; i++) '2026-${i < 4 ? '10' : '11'}-${(i < 4 ? 28 + i : i - 3).toString().padLeft(2, '0')}'],
    'completed': [for (var i = 0; i < 30; i++) i % 5],
    'accepted': [for (var i = 0; i < 30; i++) i % 3],
  },
  'history': [
    for (final s in ['ACCEPTED', 'DECLINED', 'CANCELLED', 'ACCEPTED'])
      {
        'id': 'h$s${s.length}',
        'status': s,
        'assignedAt': _iso(const Duration(days: 6)),
        'respondedAt': _iso(const Duration(days: 5)),
        'completedAt': s == 'ACCEPTED' ? _iso(const Duration(days: 4)) : null,
        'hoursToComplete': s == 'ACCEPTED' ? 26.4 : null,
        'jobOrder': {
          'id': 'j9',
          'jobOrderNo': 'JO-2026-0099',
          'status': 'CLOSED',
          'tradeUnit': {'name': 'Mechanical'},
          'report': {
            'priority': 'P2',
            'category': {'name': 'Broken Fan / Aircon'},
            'location': longPlace,
          },
        },
      },
  ],
};

final survey = {
  'units': [
    for (final u in ['Electrical', 'Plumbing', 'Mechanical'])
      {
        'id': u,
        'name': u,
        'tasks': [
          {'id': '$u.a', 'label': 'Trace and fix wiring faults in old buildings with mixed wiring'},
          {'id': '$u.b', 'label': 'Replace light fixtures and bulbs'},
        ],
      },
  ],
  'proficiencyLevels': [
    {'value': 0, 'label': 'None', 'hint': "I don't do this work"},
    {'value': 1, 'label': 'Basic', 'hint': 'Simple tasks with guidance'},
    {'value': 2, 'label': 'Intermediate', 'hint': 'Common repairs on my own'},
    {'value': 3, 'label': 'Advanced', 'hint': 'Hard repairs and diagnosis'},
    {'value': 4, 'label': 'Expert', 'hint': 'Any job; I can train others'},
  ],
  'experienceLevels': [
    {'value': 0, 'label': 'Less than 1 year'},
    {'value': 1, 'label': '1 to 2 years'},
    {'value': 2, 'label': '3 to 5 years'},
    {'value': 3, 'label': 'More than 5 years'},
  ],
  'rules': {'minScore': 50},
  'status': {
    'completedAt': _iso(const Duration(days: 20)),
    'primaryTradeUnit': {'name': 'Electrical'},
    'roles': [
      {'tradeUnit': {'name': 'Electrical'}, 'score': 88},
      {'tradeUnit': {'name': 'Mechanical'}, 'score': 54},
      {'tradeUnit': {'name': 'Plumbing'}, 'score': 51},
    ],
    'lastAnswers': {
      'units': [
        {'tradeUnitId': 'Electrical', 'proficiency': 3, 'experience': 2, 'certified': true, 'tasks': ['Electrical.a']},
      ],
    },
  },
};

final notifications = {
  'items': [
    for (final n in [
      ('job.offered', 'New job for you', 'Faulty Wiring / Outlet · New Building, Department of Management Entrepreneurship Cluster Faculty Room · P1'),
      ('job.verified', 'Job sent back for rework', 'JO-2026-0115 needs more work. Check the job for details.'),
      ('job.withdrawn', 'Job given to someone else', 'JO-2026-0130 was reassigned by the GSO. No action needed.'),
      ('form.status', 'Job Order Form returned', 'The GSO asked for changes to JOF-2026-0059.'),
      ('report.status', 'Work started', 'Ramon Cruz Villanueva started work on Faulty Wiring / Outlet.'),
    ])
      {
        'id': n.$2,
        'kind': n.$1,
        'title': n.$2,
        'body': n.$3,
        'createdAt': _iso(const Duration(hours: 3)),
        'readAt': n.$1 == 'report.status' ? _iso(const Duration(hours: 1)) : null,
      },
  ],
  'unread': 4,
  'hasMore': true,
};

final options = {
  'categories': [
    for (final c in [
      'Faulty Lighting',
      'Faulty Wiring / Outlet',
      'Broken Fan / Aircon',
      'Water Leak',
      'Clogged Toilet / Drain',
      'Damaged Chair / Table',
      'Broken Door / Window',
      'Cracked Wall / Ceiling',
      'Peeling Paint / Mold',
      'Damaged Gate / Railing',
      'Cleaning / Grounds',
    ])
      {'id': c, 'name': c, 'defaultTradeUnit': {'id': 'u1', 'name': 'Electrical'}},
  ],
  'locations': [longPlace, shortPlace],
};

/// Answers requests by path, like the real server.
class FakeServer implements HttpClientAdapter {
  Object? Function(RequestOptions o)? respond;

  Object? answer(RequestOptions o) {
    final p = o.path;
    final o2 = respond?.call(o);
    if (o2 != null) return o2;
    if (p == '/job-orders/assigned') {
      return [
        job('ASSIGNED', answer: 'PENDING', id: 'j1'),
        job('ASSIGNED', id: 'j2', category: 'Broken Fan / Aircon', trade: 'Mechanical'),
        job('IN_PROGRESS', id: 'j3', category: 'Faulty Lighting'),
        job('DELAYED', id: 'j4', category: 'Clogged Toilet / Drain', trade: 'Plumbing'),
      ];
    }
    if (p.startsWith('/job-orders/')) return job('IN_PROGRESS');
    if (p == '/analytics/me') return analytics;
    if (p == '/technicians/survey') return survey;
    if (p == '/notifications') return notifications;
    if (p == '/reports/options') return options;
    if (p == '/reports/mine') {
      return [
        report(id: 'a', status: 'CLOSED', category: 'Damaged Chair / Table', urgency: 'LOW', form: form()),
        report(id: 'b', status: 'UNDER_REVIEW', category: 'Clogged Toilet / Drain', urgency: 'HIGH', form: form(status: 'RETURNED')),
        report(id: 'c', status: 'IN_PROGRESS', form: form()),
        report(id: 'd', status: 'ASSIGNED', category: 'Water Leak', place: shortPlace, urgency: 'MEDIUM', form: form()),
        report(id: 'e', status: 'COMPLETED', category: 'Broken Fan / Aircon', form: form()),
        report(id: 'f', status: 'CLOSED', category: 'Faulty Lighting', form: form(), feedback: {'rating': 5, 'comment': 'Fast.'}),
        report(id: 'g', status: 'SUBMITTED', category: 'Peeling Paint / Mold'),
      ];
    }
    if (p.startsWith('/reports/')) return report(form: form());
    if (p == '/job-order-forms/mine') return [form()];
    if (p.startsWith('/job-order-forms/prefill/')) {
      return {
        'requester': {'fullName': 'Maria Clara Santos-Dela Cruz', 'email': 'maria@cvsu.edu.ph', 'userType': 'student'},
        'report': {
          'id': 'r1',
          'status': 'UNDER_REVIEW',
          'category': 'Clogged Toilet / Drain',
          'location': 'Old Building, 1st Floor, Male Comfort Room near the Registrar',
          'urgency': 'HIGH',
          'description': 'Toilet keeps running and the floor is wet.',
        },
        'remembered': {'department': "Registrar's Office", 'contactNumber': '0917 555 2041'},
        'existingForm': form(status: 'RETURNED'),
        'canSubmit': true,
      };
    }
    if (p.startsWith('/job-order-forms/')) return form();
    if (p == '/auth/me') return {'id': 'me', 'fullName': 'Test', 'role': 'TECHNICIAN'};
    return <String, dynamic>{};
  }

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    return ResponseBody.fromString(jsonEncode(answer(o)), 200, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

final fakeServer = FakeServer();

void useFakeServer() => ApiClient.instance.dio.httpClientAdapter = fakeServer;
