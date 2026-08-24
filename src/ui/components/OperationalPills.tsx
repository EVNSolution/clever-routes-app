import { Pressable, Text, View } from 'react-native';

import { buildOperationalPills, type OperationalPillValues } from './operationalPillModel';

export function OperationalPills({ onTakeover, values }: { onTakeover?: () => void; values: OperationalPillValues }) {
  return (
    <View accessibilityLabel="Route operational status" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {buildOperationalPills(values).map((pill) => (
        <View
          accessibilityLabel={`${pill.label}: ${pill.value}`}
          key={pill.label}
          style={{ backgroundColor: '#eef3fb', borderColor: '#cbd5e1', borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 }}
        >
          <Text style={{ color: '#475569', fontSize: 11, fontWeight: '700' }}>{pill.label}</Text>
          <Text style={{ color: '#0f172a', fontSize: 13, fontWeight: '700' }}>{pill.value}</Text>
        </View>
      ))}
      {values.deviceConflict === true && onTakeover !== undefined ? (
        <Pressable accessibilityLabel="Take over active route on this device" accessibilityRole="button" onPress={onTakeover}>
          <Text style={{ color: '#0b57d0', fontSize: 13, fontWeight: '800', padding: 8 }}>Use This Device</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
