export async function clearInvoluntaryDriverSession(input: {
  clearAccess(): Promise<void>;
  clearLocation(): Promise<void>;
}): Promise<void> {
  let accessClear: Promise<void>;
  try {
    accessClear = input.clearAccess();
  } catch (error) {
    accessClear = Promise.reject(error);
  }

  let locationClear: Promise<void>;
  try {
    locationClear = input.clearLocation();
  } catch (error) {
    locationClear = Promise.reject(error);
  }

  const [accessResult, locationResult] = await Promise.allSettled([accessClear, locationClear]);
  if (accessResult.status === 'rejected') throw accessResult.reason;
  if (locationResult.status === 'rejected') throw locationResult.reason;
}
