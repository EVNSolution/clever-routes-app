export type OperationalPillValues = {
  alert: string;
  device: string;
  gps: string;
  route: string;
  server: string;
  sync: string;
};

export function buildOperationalPills(values: OperationalPillValues) {
  return [
    { label: 'Alert', value: values.alert },
    { label: 'Route', value: values.route },
    { label: 'GPS', value: values.gps },
    { label: 'Device', value: values.device },
    { label: 'Server', value: values.server },
    { label: 'Sync', value: values.sync },
  ] as const;
}
