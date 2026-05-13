import * as ImagePicker from 'expo-image-picker';

import type {
  ProofPhotoCaptureLaunchResult,
  ProofPhotoCapturePermissionResult,
  ProofPhotoCaptureService,
  ProofPhotoCaptureSource,
} from '../../../domain/proof/proofPhotoCapture';

export function createExpoProofPhotoCaptureService(): ProofPhotoCaptureService {
  return {
    launchCapture: async (source) => launchImagePicker(source),
    requestPermission: async (source) => requestImagePickerPermission(source),
  };
}

async function requestImagePickerPermission(source: ProofPhotoCaptureSource): Promise<ProofPhotoCapturePermissionResult> {
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();

  return permission.status === 'granted' ? 'granted' : 'denied';
}

async function launchImagePicker(source: ProofPhotoCaptureSource): Promise<ProofPhotoCaptureLaunchResult> {
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(getImagePickerOptions())
    : await ImagePicker.launchImageLibraryAsync(getImagePickerOptions());

  if (result.canceled || result.assets.length === 0) {
    return { kind: 'cancelled' };
  }

  return { kind: 'captured', uri: result.assets[0]?.uri ?? '' };
}

function getImagePickerOptions(): ImagePicker.ImagePickerOptions {
  return {
    allowsEditing: false,
    mediaTypes: ['images'],
    quality: 0.7,
  };
}
