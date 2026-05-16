import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Animated, StatusBar, Dimensions, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { saveAuthData, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../utils/config';

const { width } = Dimensions.get('window');

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Animation states
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(40));
  const [scanlineAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Fade in animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    // Subtle scanline effect for command center feel
    const scanline = Animated.loop(
      Animated.timing(scanlineAnim, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: false,
      })
    );
    scanline.start();

    return () => scanline.stop();
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    await clearAuthData();

    try {
      const response = await axios.post(`${BACKEND_URL}/api/admin/login`, {
        email: email.trim().toLowerCase(),
        password,
      }, { timeout: 15000 });

      const saved = await saveAuthData({
        token: response.data.token,
        user_id: String(response.data.user_id),
        role: 'admin',
        is_premium: false,
      });

      if (!saved) {
        throw new Error('Failed to save authentication data');
      }

      router.replace('/admin/dashboard');
    } catch (error: any) {
      let errorMessage = 'An unexpected error occurred';

      if (error.response) {
        errorMessage = error.response.data?.detail ||
                       error.response.data?.message ||
                       'Invalid admin credentials.';
      } else if (error.request) {
        errorMessage = 'Server is unreachable. Please check your internet connection.';
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Connection timed out. Please try again.';
      } else {
        errorMessage = error.message || 'Login failed. Please try again.';
      }

      Alert.alert('Access Denied', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Command Center Background */}
      <View style={styles.bgGradient} />
      <View style={styles.bgGrid} />

      {/* Top accent glow */}
      <View style={styles.topGlow} />

      {/* Corner accents - Upper corners */}
      <View style={styles.cornerTL} />
      <View style={styles.cornerTR} />

      {/* Corner accents - Lower corners (brought up for visibility) */}
      <View style={styles.cornerBL} />
      <View style={styles.cornerBR} />

      {/* Bottom border line (raised for visibility) */}
      <View style={styles.bottomBorderLine} />
      <View style={styles.bottomBorderLineLeft} />
      <View style={styles.bottomBorderLineRight} />

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* Header Section */}
            <View style={styles.headerSection}>
              {/* Shield Icon with Ring */}
              <View style={styles.shieldContainer}>
                <View style={styles.shieldOuterRing} />
                <View style={styles.shieldMiddleRing} />
                <View style={styles.shieldIcon}>
                  <Ionicons name="shield-checkmark" size={40} color="#fff" />
                </View>
                <View style={styles.scanLine} />
              </View>

              {/* Title */}
              <View style={styles.titleContainer}>
                <Text style={styles.titleTop}>ADMIN PORTAL</Text>
                <Text style={styles.titleSub}>Se-Q Management Console</Text>
              </View>

              {/* Status Badge */}
              <View style={styles.statusBadge}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>SECURE CONNECTION</Text>
              </View>
            </View>

            {/* Form Section */}
            <View style={styles.formSection}>
              <Text style={styles.formTitle}>Authenticate</Text>

              {/* Email Field */}
              <View style={styles.inputContainer}>
                <View style={styles.inputIconWrap}>
                  <Ionicons name="person" size={20} color="#A78BFA" />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Administrator Email"
                  placeholderTextColor="#6B7280"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Password Field */}
              <View style={styles.inputContainer}>
                <View style={styles.inputIconWrap}>
                  <Ionicons name="key" size={20} color="#A78BFA" />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#6B7280"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={20}
                    color="#6B7280"
                  />
                </TouchableOpacity>
              </View>

              {/* Login Button */}
              <TouchableOpacity
                style={[styles.loginButton, loading && styles.loginButtonDisabled]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <View style={styles.loginButtonContent}>
                    <Ionicons name="log-in" size={20} color="#fff" />
                    <Text style={styles.loginButtonText}>Access Dashboard</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Footer Section */}
            <View style={styles.footerSection}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.replace('/auth/login')}
                activeOpacity={0.7}
              >
                <View style={styles.backIconContainer}>
                  <Ionicons name="arrow-back" size={18} color="#8B5CF6" />
                </View>
                <Text style={styles.backText}>Return to App Login</Text>
              </TouchableOpacity>

              {/* Security Notice */}
              <View style={styles.securityNotice}>
                <Ionicons name="lock-closed" size={14} color="#4B5563" />
                <Text style={styles.securityText}>All access attempts are logged and monitored</Text>
              </View>
            </View>

          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0A0F',
  },
  bgGrid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.03,
    borderWidth: 1,
    borderColor: '#6366F1',
  },
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
    backgroundColor: '#6366F1',
    opacity: 0.05,
  },
  cornerTL: {
    position: 'absolute',
    top: 40,
    left: 24,
    width: 60,
    height: 60,
    borderLeftWidth: 2,
    borderTopWidth: 2,
    borderColor: '#6366F1',
    opacity: 0.5,
  },
  cornerTR: {
    position: 'absolute',
    top: 40,
    right: 24,
    width: 60,
    height: 60,
    borderRightWidth: 2,
    borderTopWidth: 2,
    borderColor: '#6366F1',
    opacity: 0.5,
  },
  cornerBL: {
    position: 'absolute',
    bottom: 120,
    left: 24,
    width: 60,
    height: 60,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#6366F1',
    opacity: 0.5,
  },
  cornerBR: {
    position: 'absolute',
    bottom: 120,
    right: 24,
    width: 60,
    height: 60,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#6366F1',
    opacity: 0.5,
  },
  bottomBorderLine: {
    position: 'absolute',
    bottom: 80,
    left: 24,
    right: 24,
    height: 2,
    backgroundColor: '#6366F1',
    opacity: 0.4,
  },
  bottomBorderLineLeft: {
    position: 'absolute',
    bottom: 80,
    left: 24,
    width: 2,
    height: 30,
    backgroundColor: '#6366F1',
    opacity: 0.4,
  },
  bottomBorderLineRight: {
    position: 'absolute',
    bottom: 80,
    right: 24,
    width: 2,
    height: 30,
    backgroundColor: '#6366F1',
    opacity: 0.4,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 48,
  },
  shieldContainer: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  shieldOuterRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  shieldMiddleRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.5)',
  },
  shieldIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  scanLine: {
    position: 'absolute',
    width: 80,
    height: 2,
    backgroundColor: '#A78BFA',
    opacity: 0.5,
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  titleTop: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 6,
    marginBottom: 4,
  },
  titleSub: {
    fontSize: 14,
    color: '#6B7280',
    letterSpacing: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  statusText: {
    fontSize: 11,
    color: '#10B981',
    fontWeight: '600',
    letterSpacing: 1,
  },
  formSection: {
    marginBottom: 40,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 24,
    letterSpacing: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 30, 45, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
    marginBottom: 16,
    overflow: 'hidden',
  },
  inputIconWrap: {
    width: 52,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(139, 92, 246, 0.2)',
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  eyeButton: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  loginButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 1,
  },
  footerSection: {
    alignItems: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    marginBottom: 24,
  },
  backIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: {
    color: '#8B5CF6',
    fontSize: 14,
    fontWeight: '500',
  },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  securityText: {
    fontSize: 11,
    color: '#4B5563',
    letterSpacing: 0.5,
  },
});
