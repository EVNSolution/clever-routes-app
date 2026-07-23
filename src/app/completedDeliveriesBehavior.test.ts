import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

function getCompletedDeliveriesSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function CompletedDeliveriesScreen(');
  const end = source.indexOf('function ScreenHeader(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('Completed Deliveries behavior', () => {
  it('uses working delivery-outcome tabs instead of proof-presence placeholders', () => {
    const source = getCompletedDeliveriesSource();

    assert.match(source, /useState<CompletedDeliveriesFilter>\('all'\)/u);
    assert.match(source, /\{ id: 'all', label: 'All' \}/u);
    assert.match(source, /\{ id: 'delivered', label: 'Delivered' \}/u);
    assert.match(source, /\{ id: 'issues', label: 'Issues' \}/u);
    assert.match(source, /accessibilityRole="tab"/u);
    assert.match(source, /accessibilityState=\{\{ selected \}\}/u);
    assert.match(source, /onPress=\{\(\) => setSelectedFilter\(filter\.id\)\}/u);
    assert.match(source, /getCompletedDeliveryOutcome\(stop\) === selectedFilter/u);
    assert.doesNotMatch(source, /Proof Missing|With Issues|proofMediaResults|filterPill/u);
  });

  it('opens completed stop details from the whole flat list row', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const completedSource = getCompletedDeliveriesSource();

    assert.match(completedSource, /<Pressable[\s\S]*accessibilityLabel=\{`Open completed Stop \$\{stop\.sequence\} details`\}[\s\S]*onPress=\{\(\) => onOpenStop\(stop\)\}/u);
    assert.match(source, /setStopDetailsReturnScreen\('completedDeliveries'\);[\s\S]*setScreen\('stopDetails'\)/u);
    assert.match(source, /case 'stopDetails':[\s\S]*setScreen\(stopDetailsReturnScreen\)/u);
    assert.match(source, /isReadOnly=\{stopDetailsReturnScreen === 'completedDeliveries'\}/u);
    assert.match(source, /\{isReadOnly \? null : \([\s\S]*label="Arrive"/u);
    assert.match(source, /screen === 'completedDeliveries'[\s\S]*stopDetailsReturnScreen === 'completedDeliveries'[\s\S]*\? selectedRouteId/u);
  });

  it('uses a flat summary and divided rows without fake filter or time controls', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const completedSource = getCompletedDeliveriesSource();
    const listStyles = source.slice(source.indexOf('completedList:'), source.indexOf('emptyCard:'));

    assert.match(completedSource, /<ScreenHeader hideRightAction/u);
    assert.match(completedSource, /<CompletedDeliveryMetric label="Completed"/u);
    assert.match(completedSource, /<CompletedDeliveryMetric label="Delivered"/u);
    assert.match(completedSource, /<CompletedDeliveryMetric label="Issues"/u);
    assert.doesNotMatch(completedSource, /rightLabel="Filter"|Completed Time|completionSummaryCard|completedListCard/u);
    assert.doesNotMatch(listStyles, /borderRadius|shadow/u);
  });
});
