import 'package:flutter/material.dart';

/// Small number tile used on dashboards: icon, big value, label, optional hint.
class KpiTile extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color? color;
  final String? hint;

  const KpiTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.color,
    this.hint,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.primary;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(children: [
              Icon(icon, size: 18, color: c),
              const SizedBox(width: 6),
              Expanded(
                child: Text(label,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: Colors.grey)),
              ),
            ]),
            const SizedBox(height: 6),
            Text(value,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
            if (hint != null)
              Text(hint!,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11, color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}

/// A titled card that wraps a chart or list.
class SectionCard extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget child;

  const SectionCard({super.key, required this.title, this.subtitle, required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
            if (subtitle != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(subtitle!,
                    style: const TextStyle(fontSize: 12, color: Colors.grey)),
              ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

/// Vertical columns (e.g. jobs finished per week). No chart library needed.
class ColumnChart extends StatelessWidget {
  final List<String> labels;
  final List<num> values;
  final double height;
  final Color? color;

  const ColumnChart({
    super.key,
    required this.labels,
    required this.values,
    this.height = 120,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.primary;
    final max = values.fold<num>(1, (m, v) => v > m ? v : m);
    return SizedBox(
      height: height + 36,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (var i = 0; i < values.length; i++)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Text(values[i] > 0 ? '${values[i]}' : '',
                        style: const TextStyle(fontSize: 11)),
                    const SizedBox(height: 2),
                    Container(
                      height: values[i] == 0 ? 2 : (height * values[i] / max).toDouble(),
                      decoration: BoxDecoration(
                        color: values[i] == 0 ? c.withValues(alpha: 0.25) : c,
                        borderRadius:
                            const BorderRadius.vertical(top: Radius.circular(4)),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(labels[i],
                        maxLines: 1,
                        overflow: TextOverflow.clip,
                        style: const TextStyle(fontSize: 10, color: Colors.grey)),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One horizontal bar with a label and a count.
class BarRow extends StatelessWidget {
  final String label;
  final num value;
  final num max;
  final Color? color;

  const BarRow({
    super.key,
    required this.label,
    required this.value,
    required this.max,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 110,
            child: Text(label, overflow: TextOverflow.ellipsis),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: max <= 0 ? 0 : (value / max).toDouble().clamp(0.0, 1.0),
                minHeight: 10,
                color: c,
                backgroundColor: c.withValues(alpha: 0.12),
              ),
            ),
          ),
          SizedBox(
            width: 34,
            child: Text('$value',
                textAlign: TextAlign.right,
                style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

/// Five stars filled up to [rating].
class StarRow extends StatelessWidget {
  final num rating;
  final double size;
  const StarRow({super.key, required this.rating, this.size = 18});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 1; i <= 5; i++)
          Icon(i <= rating.round() ? Icons.star : Icons.star_border,
              size: size, color: Colors.amber.shade700),
      ],
    );
  }
}