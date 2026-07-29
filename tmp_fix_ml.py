from pathlib import Path
path = Path('mobile/src/screens/MLAnalyticsScreen.tsx')
text = path.read_text()
needle = '''              <Title style={[styles.metricValue, { color: theme.colors.secondary }]}> 
                {businessMetrics.customer_analytics?.total_customers ?? 'N/A'}
              <Icon name="package-variant" size="24" color={theme.colors.tertiary} />'''
print('FOUND' if needle in text else 'NOT FOUND')
print('---')
print(repr(needle))
