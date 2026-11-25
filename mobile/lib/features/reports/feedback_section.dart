import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../core/api_client.dart';

// shown on a CLOSED report: the reporter rates the work, once
class FeedbackSection extends StatefulWidget {
  final String reportId;
  final Map<String, dynamic>? feedback; // existing feedback, if any
  final VoidCallback onSubmitted;

  const FeedbackSection({
    super.key,
    required this.reportId,
    required this.feedback,
    required this.onSubmitted,
  });

  @override
  State<FeedbackSection> createState() => _FeedbackSectionState();
}

class _FeedbackSectionState extends State<FeedbackSection> {
  int rating = 0;
  final commentCtrl = TextEditingController();
  bool sending = false;

  @override
  void dispose() {
    commentCtrl.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    setState(() => sending = true);
    try {
      final comment = commentCtrl.text.trim();
      await ApiClient.instance.dio.post(
        '/reports/${widget.reportId}/feedback',
        data: {
          'rating': rating,
          if (comment.isNotEmpty) 'comment': comment,
        },
      );
      widget.onSubmitted();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(errorMessage(e))));
      }
    }
    if (mounted) setState(() => sending = false);
  }

  Widget _stars(int value, {ValueChanged<int>? onChanged}) => Row(
        mainAxisSize: MainAxisSize.min,
        children: List.generate(5, (i) {
          final icon = Icon(
            i < value ? Icons.star : Icons.star_border,
            color: Colors.amber.shade700,
            size: 34,
          );
          if (onChanged == null) return icon;
          return GestureDetector(
            onTap: () => onChanged(i + 1),
            child: Padding(padding: const EdgeInsets.only(right: 4), child: icon),
          );
        }),
      );

  @override
  Widget build(BuildContext context) {
    final fb = widget.feedback;
    final titleStyle = Theme.of(context).textTheme.titleMedium;

    if (fb != null) {
      final comment = fb['comment'] as String?;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Your feedback', style: titleStyle),
          const SizedBox(height: 8),
          _stars(fb['rating'] as int),
          if (comment != null && comment.isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(comment)),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('How was the repair?', style: titleStyle),
        Text(
          'The work was verified and closed. Please rate it.',
          style: TextStyle(color: context.c.muted),
        ),
        const SizedBox(height: 8),
        _stars(rating, onChanged: (v) => setState(() => rating = v)),
        const SizedBox(height: 8),
        TextField(
          controller: commentCtrl,
          maxLines: 3,
          maxLength: 500,
          decoration: const InputDecoration(
            labelText: 'Comments (optional)',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: sending || rating == 0 ? null : submit,
          child: Text(sending ? 'Sending...' : 'Submit feedback'),
        ),
      ],
    );
  }
}