import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Modal,
  FlatList,
} from 'react-native';
import Voice, {
  SpeechResultsEvent,
  SpeechErrorEvent,
} from '@react-native-voice/voice';
import Tts from 'react-native-tts';

// Interfaces for TTS Engine voices
interface TTSVoice {
  id: string;
  name: string;
  language: string;
  quality?: number;
  latency?: number;
  notInstalled?: boolean;
}

export default function App() {
  // --- CONFIGURATION STATE ---
  const [sttLocale, setSttLocale] = useState<string>('en-US');
  const [speechRate, setSpeechRate] = useState<number>(0.5); // Default 0.5 is normal speed for Tts
  const [speechPitch, setSpeechPitch] = useState<number>(1.0); // 1.0 is default pitch
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [voiceListVisible, setVoiceListVisible] = useState<boolean>(false);

  // --- STT & TTS ACTIVE STATES ---
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [transcribedText, setTranscribedText] = useState<string>('');
  const [ttsInputText, setTtsInputText] = useState<string>(
    'Hello! This is a test of the on-device text to speech engine. Adjust my rate and pitch to customize my voice!'
  );

  // --- ERROR AND DIAGNOSTIC STATES ---
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [ttsInitialized, setTtsInitialized] = useState<boolean>(false);

  // --- PULSING ANIMATION REFERENCE ---
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // --- STT ERROR MAPPING LOGIC ---
  const mapSTTError = (errorEvent: SpeechErrorEvent | any): string => {
    if (!errorEvent) return 'Unknown STT error.';
    
    // Extract raw message or error code
    const rawError = errorEvent.error?.message || errorEvent.message || String(errorEvent);
    console.log('[STT Raw Error]:', rawError);

    // Map system codes (primarily Android SpeechRecognizer errors)
    if (rawError.includes('1') || rawError.toLowerCase().includes('network_timeout')) {
      return 'Network timeout. Please ensure your device has internet connectivity.';
    }
    if (rawError.includes('2') || rawError.toLowerCase().includes('network')) {
      return 'Network communication error. Double check internet and DNS settings.';
    }
    if (rawError.includes('3') || rawError.toLowerCase().includes('audio')) {
      return 'Audio recording failed. Check if another app is utilizing the microphone.';
    }
    if (rawError.includes('4') || rawError.toLowerCase().includes('server')) {
      return 'Google Speech Recognition server error. Please try again later.';
    }
    if (rawError.includes('5') || rawError.toLowerCase().includes('client')) {
      return 'Speech Recognition client interface error.';
    }
    if (rawError.includes('6') || rawError.toLowerCase().includes('speech_timeout')) {
      return 'No speech detected. The microphone stopped listening. Please try again.';
    }
    if (rawError.includes('7') || rawError.toLowerCase().includes('no_match')) {
      return 'Speech could not be matched to a vocabulary. Speak clearly and closer to the microphone.';
    }
    if (rawError.includes('8') || rawError.toLowerCase().includes('busy')) {
      return 'Speech recognition service is currently busy. Try toggling the microphone again.';
    }
    if (rawError.includes('9') || rawError.toLowerCase().includes('permission')) {
      return 'Microphone access denied. Please allow RECORD_AUDIO permission in app settings.';
    }

    return `Recognition Error: ${rawError}`;
  };

  // --- PERMISSION HANDLER ---
  const checkMicrophonePermission = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const hasPermission = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        );
        if (hasPermission) return true;

        const requestResult = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission Needed',
            message: 'AcousticLab requires microphone access to transcribe speech in real-time.',
            buttonNeutral: 'Ask Later',
            buttonNegative: 'Deny',
            buttonPositive: 'Grant Access',
          }
        );
        return requestResult === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        setDiagnosticError(`Permission Error: ${String(err)}`);
        return false;
      }
    }
    return true; // iOS permission is auto-prompted by framework
  };

  // --- INITIALIZE ENGINES AND ATTACH LIFECYCLE LISTENERS ---
  useEffect(() => {
    // 1. Initialize Speech-To-Text (Voice) listeners
    Voice.onSpeechStart = () => {
      setIsListening(true);
      setDiagnosticError(null);
    };

    Voice.onSpeechEnd = () => {
      setIsListening(false);
    };

    Voice.onSpeechError = (e: SpeechErrorEvent) => {
      const parsedError = mapSTTError(e);
      setDiagnosticError(parsedError);
      setIsListening(false);
    };

    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      if (e.value && e.value.length > 0) {
        setTranscribedText(e.value[0]);
      }
    };

    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      if (e.value && e.value.length > 0) {
        setTranscribedText(e.value[0]);
      }
    };

    // 2. Initialize Text-To-Speech (Tts) engine
    Tts.getInitStatus()
      .then(
        () => {
          setTtsInitialized(true);
          loadTtsVoices();
        },
        (err) => {
          setDiagnosticError(`TTS Initialization failed: ${err.message || err}. Make sure Google Speech Services are active.`);
        }
      );

    const ttsStartListener = Tts.addEventListener('tts-start', () => setIsSpeaking(true));
    const ttsFinishListener = Tts.addEventListener('tts-finish', () => setIsSpeaking(false));
    const ttsCancelListener = Tts.addEventListener('tts-cancel', () => setIsSpeaking(false));
    const ttsErrorListener = Tts.addEventListener('tts-error', (err) => {
      setDiagnosticError(`TTS Engine error occurred during reading: ${String(err)}`);
      setIsSpeaking(false);
    });

    // 3. Cleanup lifecycle on component unmount (avoid memory leaks)
    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
      Tts.stop();
      ttsStartListener.remove();
      ttsFinishListener.remove();
      ttsCancelListener.remove();
      ttsErrorListener.remove();
    };
  }, []);

  // --- LOAD INSTALLED VOICES FROM DEVICE TTS ---
  const loadTtsVoices = async () => {
    try {
      const list = await Tts.voices();
      const filteredVoices: TTSVoice[] = list.map((v) => ({
        id: v.id,
        name: v.name,
        language: v.language,
        quality: v.quality,
        latency: v.latency,
        notInstalled: v.notInstalled,
      }));

      // Filter out voices requiring download/not fully installed on device
      const installedVoices = filteredVoices.filter((v) => !v.notInstalled);
      setVoices(installedVoices);

      // Select default system voice if available
      if (installedVoices.length > 0) {
        const defaultVoice = installedVoices.find((v) => v.language.startsWith('en')) || installedVoices[0];
        setSelectedVoice(defaultVoice.id);
        Tts.setDefaultVoice(defaultVoice.id);
      }
    } catch (err) {
      console.warn('[TTS load voices error]:', err);
    }
  };

  // --- MICROPHONE PULSING ANIMATION CONTROLLER ---
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isListening) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 850,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 850,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      pulseAnim.setValue(1);
    }

    return () => {
      if (animation) animation.stop();
    };
  }, [isListening]);

  // --- VOICE SPEECH TRIGGER (STT) ---
  const startSpeechRecognition = async () => {
    const hasPermission = await checkMicrophonePermission();
    if (!hasPermission) {
      setDiagnosticError('Cannot start: Microphone permission was denied.');
      return;
    }

    setTranscribedText('');
    setDiagnosticError(null);

    try {
      await Voice.start(sttLocale);
    } catch (e) {
      setDiagnosticError(`Failed to start STT engine: ${String(e)}`);
      setIsListening(false);
    }
  };

  const stopSpeechRecognition = async () => {
    try {
      await Voice.stop();
    } catch (e) {
      console.warn('[STT stop error]:', e);
    }
  };

  // --- READ TEXT ALOUD (TTS) ---
  const readTextAloud = async () => {
    if (!ttsInitialized) {
      setDiagnosticError('TTS Engine is not initialized yet. Please wait.');
      return;
    }
    if (!ttsInputText.trim()) {
      setDiagnosticError('TTS Input box is empty. Please enter some text to speak.');
      return;
    }

    setDiagnosticError(null);
    try {
      await Tts.stop(); // Stop any currently playing audio stream
      await Tts.setDefaultRate(speechRate);
      await Tts.setDefaultPitch(speechPitch);
      if (selectedVoice) {
        await Tts.setDefaultVoice(selectedVoice);
      }
      Tts.speak(ttsInputText);
    } catch (err: any) {
      setDiagnosticError(`TTS Playback failed: ${err.message || err}`);
    }
  };

  // --- FORMAT TTS VOICE DISPLAY NAMES ---
  const getSelectedVoiceName = () => {
    const found = voices.find((v) => v.id === selectedVoice);
    if (!found) return 'Default Voice / Locale';
    return `${found.name} (${found.language})`;
  };

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />
      
      {/* HEADER BANNER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AcousticLab</Text>
        <Text style={styles.headerSubtitle}>Native STT & TTS Dashboard</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        
        {/* DIAGNOSTIC ERROR BANNER */}
        {diagnosticError && (
          <View style={styles.errorBanner}>
            <View style={styles.errorIconContainer}>
              <Text style={styles.errorIcon}>⚠️</Text>
            </View>
            <View style={styles.errorTextContainer}>
              <Text style={styles.errorBannerTitle}>System Diagnostic Alert</Text>
              <Text style={styles.errorBannerText}>{diagnosticError}</Text>
            </View>
            <TouchableOpacity onPress={() => setDiagnosticError(null)} style={styles.errorCloseBtn}>
              <Text style={styles.errorCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ======================================= */}
        {/* SECTION 1: CONFIGURATION PANEL          */}
        {/* ======================================= */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>⚙️ Engine Configurations</Text>
          <View style={styles.divider} />

          {/* STT Locale selection */}
          <Text style={styles.fieldLabel}>Voice-To-Text Locale (STT)</Text>
          <View style={styles.sttLocaleRow}>
            {[
              { label: 'English (US)', value: 'en-US' },
              { label: 'English (IN)', value: 'en-IN' },
              { label: 'Hindi (IN)', value: 'hi-IN' },
            ].map((locale) => (
              <TouchableOpacity
                key={locale.value}
                activeOpacity={0.8}
                style={[
                  styles.segmentButton,
                  sttLocale === locale.value && styles.segmentButtonActive,
                ]}
                onPress={() => setSttLocale(locale.value)}
              >
                <Text
                  style={[
                    styles.segmentButtonText,
                    sttLocale === locale.value && styles.segmentButtonTextActive,
                  ]}
                >
                  {locale.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* TTS Speech Rate (Speed Slider) */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.fieldLabel}>TTS Speech Rate (Speed)</Text>
              <Text style={styles.sliderValueText}>{speechRate.toFixed(2)}x</Text>
            </View>
            <View style={styles.stepperContainer}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => setSpeechRate(Math.max(0.1, speechRate - 0.05))}
              >
                <Text style={styles.stepperText}>-</Text>
              </TouchableOpacity>
              <View style={styles.trackContainer}>
                <View style={styles.trackBackground}>
                  <View style={[styles.trackFill, { width: `${(speechRate / 2.0) * 100}%` }]} />
                </View>
              </View>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => setSpeechRate(Math.min(2.0, speechRate + 0.05))}
              >
                <Text style={styles.stepperText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* TTS Pitch (Pitch Slider) */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.fieldLabel}>TTS Voice Pitch</Text>
              <Text style={styles.sliderValueText}>{speechPitch.toFixed(2)}</Text>
            </View>
            <View style={styles.stepperContainer}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => setSpeechPitch(Math.max(0.5, speechPitch - 0.1))}
              >
                <Text style={styles.stepperText}>-</Text>
              </TouchableOpacity>
              <View style={styles.trackContainer}>
                <View style={styles.trackBackground}>
                  <View style={[styles.trackFill, { width: `${((speechPitch - 0.5) / 1.5) * 100}%` }]} />
                </View>
              </View>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => setSpeechPitch(Math.min(2.0, speechPitch + 0.1))}
              >
                <Text style={styles.stepperText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* TTS Installed Voices selector */}
          <Text style={styles.fieldLabel}>Text-To-Voice Engine Speech Profile</Text>
          <TouchableOpacity
            style={styles.selectorTrigger}
            activeOpacity={0.8}
            onPress={() => setVoiceListVisible(true)}
          >
            <Text style={styles.selectorTriggerText} numberOfLines={1}>
              {getSelectedVoiceName()}
            </Text>
            <Text style={styles.selectorTriggerChevron}>▼</Text>
          </TouchableOpacity>
        </View>

        {/* ======================================= */}
        {/* SECTION 2: VOICE-TO-TEXT (STT) TEST AREA*/}
        {/* ======================================= */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🎙️ Voice-To-Text (STT)</Text>
          <View style={styles.divider} />

          {/* Pulse mic triggers */}
          <View style={styles.microphoneWrapper}>
            <Animated.View
              style={[
                styles.micPulseRing,
                {
                  transform: [{ scale: pulseAnim }],
                  backgroundColor: isListening ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.15)',
                },
              ]}
            >
              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.micButton,
                  isListening ? styles.micButtonListening : styles.micButtonIdle,
                ]}
                onPress={isListening ? stopSpeechRecognition : startSpeechRecognition}
              >
                <Text style={styles.micIconText}>🎤</Text>
              </TouchableOpacity>
            </Animated.View>
            <Text style={[styles.statusText, isListening && styles.statusListeningText]}>
              {isListening ? 'Listening for speech input...' : 'Tap Mic to Start Recognition'}
            </Text>
          </View>

          {/* Transcribed Speech Output Box */}
          <Text style={styles.smallLabel}>Real-time Transcribed Output</Text>
          <View style={styles.transcriptionBox}>
            <ScrollView style={styles.transcriptScroll} nestedScrollEnabled={true}>
              {transcribedText ? (
                <Text style={styles.transcriptText}>{transcribedText}</Text>
              ) : (
                <Text style={styles.transcriptPlaceholder}>
                  Press the microphone button and begin speaking. Your words will appear here...
                </Text>
              )}
            </ScrollView>
          </View>
          
          {transcribedText ? (
            <TouchableOpacity 
              style={styles.clearBtn} 
              onPress={() => setTranscribedText('')}
            >
              <Text style={styles.clearBtnText}>Clear Transcript</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ======================================= */}
        {/* SECTION 3: TEXT-TO-VOICE (TTS) TEST AREA*/}
        {/* ======================================= */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔊 Text-To-Voice (TTS)</Text>
          <View style={styles.divider} />

          <Text style={styles.fieldLabel}>Custom Vocalization Text</Text>
          <TextInput
            style={styles.textInput}
            multiline
            numberOfLines={3}
            value={ttsInputText}
            onChangeText={setTtsInputText}
            placeholder="Write words to synthesize..."
            placeholderTextColor="#64748B"
          />

          {/* Speak Button */}
          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.speakButton,
              isSpeaking ? styles.speakButtonSpeaking : styles.speakButtonIdle,
            ]}
            onPress={isSpeaking ? () => Tts.stop() : readTextAloud}
          >
            {isSpeaking ? (
              <View style={styles.speakButtonRow}>
                <ActivityIndicator size="small" color="#FFFFFF" style={styles.loadingMargin} />
                <Text style={styles.speakButtonText}>Stop Synthesis</Text>
              </View>
            ) : (
              <Text style={styles.speakButtonText}>Read Text Aloud</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* TTS VOICES SELECTION MODAL */}
      <Modal
        visible={voiceListVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setVoiceListVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose TTS Engine Profile</Text>
              <TouchableOpacity onPress={() => setVoiceListVisible(false)}>
                <Text style={styles.modalCloseText}>Done</Text>
              </TouchableOpacity>
            </View>
            
            {voices.length === 0 ? (
              <View style={styles.modalEmpty}>
                <ActivityIndicator size="large" color="#6366F1" />
                <Text style={styles.modalEmptyText}>Scanning devices voices...</Text>
              </View>
            ) : (
              <FlatList
                data={voices}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.voiceItem,
                      selectedVoice === item.id && styles.voiceItemActived,
                    ]}
                    onPress={() => {
                      setSelectedVoice(item.id);
                      Tts.setDefaultVoice(item.id);
                    }}
                  >
                    <View style={styles.voiceItemDetails}>
                      <Text style={styles.voiceItemName}>{item.name}</Text>
                      <Text style={styles.voiceItemLang}>Locale: {item.language}</Text>
                    </View>
                    {selectedVoice === item.id && (
                      <Text style={styles.checkmarkIcon}>✓</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// --- PREMIUM DESIGN STYLESHEET (GLASSMORPHISM / DARK THEME) ---
const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  header: {
    paddingVertical: 18,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6366F1',
    fontWeight: '600',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: 'rgba(30, 41, 59, 0.45)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 18,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 12,
  },
  fieldLabel: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
    marginBottom: 8,
  },
  smallLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  sttLocaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  segmentButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
  },
  segmentButtonActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: '#6366F1',
  },
  segmentButtonText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  segmentButtonTextActive: {
    color: '#818CF8',
    fontWeight: '700',
  },
  sliderSection: {
    marginBottom: 18,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sliderValueText: {
    color: '#6366F1',
    fontWeight: '700',
    fontSize: 14,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  stepperText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  trackContainer: {
    flex: 1,
    marginHorizontal: 12,
  },
  trackBackground: {
    height: 6,
    backgroundColor: '#1E293B',
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 3,
  },
  selectorTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  selectorTriggerText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 10,
  },
  selectorTriggerChevron: {
    color: '#64748B',
    fontSize: 10,
  },
  microphoneWrapper: {
    alignItems: 'center',
    marginVertical: 14,
  },
  micPulseRing: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
  },
  micButtonIdle: {
    backgroundColor: '#6366F1',
  },
  micButtonListening: {
    backgroundColor: '#EF4444',
  },
  micIconText: {
    fontSize: 28,
  },
  statusText: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  statusListeningText: {
    color: '#EF4444',
  },
  transcriptionBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 14,
    height: 120,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  transcriptScroll: {
    flex: 1,
  },
  transcriptText: {
    color: '#E2E8F0',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  transcriptPlaceholder: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  clearBtn: {
    alignSelf: 'flex-end',
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    padding: 12,
    color: '#FFFFFF',
    fontSize: 14,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  speakButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakButtonIdle: {
    backgroundColor: '#6366F1',
  },
  speakButtonSpeaking: {
    backgroundColor: '#D946EF',
  },
  speakButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  speakButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingMargin: {
    marginRight: 8,
  },
  errorBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
    borderColor: 'rgba(244, 63, 94, 0.3)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  errorIconContainer: {
    marginRight: 10,
  },
  errorIcon: {
    fontSize: 18,
  },
  errorTextContainer: {
    flex: 1,
  },
  errorBannerTitle: {
    color: '#FDA4AF',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  errorBannerText: {
    color: '#FECDD3',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 16,
  },
  errorCloseBtn: {
    padding: 6,
    marginLeft: 6,
  },
  errorCloseText: {
    color: '#FDA4AF',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '65%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalCloseText: {
    color: '#6366F1',
    fontWeight: '700',
    fontSize: 14,
  },
  modalEmpty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  modalEmptyText: {
    color: '#94A3B8',
    marginTop: 12,
    fontSize: 13,
  },
  voiceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.03)',
  },
  voiceItemActived: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderRadius: 8,
  },
  voiceItemDetails: {
    flex: 1,
  },
  voiceItemName: {
    fontSize: 14,
    color: '#F1F5F9',
    fontWeight: '600',
  },
  voiceItemLang: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  checkmarkIcon: {
    color: '#6366F1',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
