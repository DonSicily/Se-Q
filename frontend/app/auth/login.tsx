import React, { useState, useEffect } from 'react';
import { View, Text, Image, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Animated, Dimensions, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { saveAuthData, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../utils/config';

const { width } = Dimensions.get('window');

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Animation states
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(30));
  const [pulseAnim] = useState(new Animated.Value(1));

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

    // Subtle pulse animation for logo
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    await clearAuthData();

    try {
      const response = await axios.post(`${BACKEND_URL}/api/auth/login`, {
        email: email.trim().toLowerCase(),
        password,
      }, { timeout: 15000 });

      const saved = await saveAuthData({
        token:      response.data.token,
        user_id:    String(response.data.user_id),
        role:       response.data.role,
        is_premium: response.data.is_premium,
      });

      if (!saved) throw new Error('Failed to save authentication data');

      if (response.data.role === 'admin') {
        router.replace('/admin/dashboard');
      } else if (response.data.role === 'security') {
        router.replace('/security/home');
      } else {
        router.replace('/civil/home');
      }

    } catch (error: any) {
      let errorMessage = 'An unexpected error occurred';
      if (error.response) {
        errorMessage = error.response.data?.detail ||
                       error.response.data?.message ||
                       'Invalid credentials. Please try again.';
      } else if (error.request) {
        errorMessage = 'Server is unreachable. Please check your internet connection.';
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Connection timed out. Please try again.';
      } else {
        errorMessage = error.message || 'Login failed. Please try again.';
      }
      Alert.alert('Login Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Background gradient effect using layers */}
      <View style={styles.gradientOverlay} />
      <View style={styles.gradientOverlay2} />

      {/* Decorative elements */}
      <View style={styles.topLeftGlow} />
      <View style={styles.bottomRightGlow} />

      {/* Geometric pattern */}
      <View style={styles.geometricPattern}>
        <View style={styles.hexagon} />
        <View style={[styles.hexagon, styles.hexagon2]} />
        <View style={[styles.hexagon, styles.hexagon3]} />
      </View>

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* Logo Section */}
            <View style={styles.logoSection}>
              <Animated.View style={[styles.logoContainer, { transform: [{ scale: pulseAnim }] }]}>
                <View style={styles.logoGlow} />
                <View style={styles.logoIcon}>
                  <Image
                    source={require('../../assets/images/login-logo.png')}
                    style={styles.logoImage}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.logoRing} />
              </Animated.View>
              <Text style={styles.appName}>Se-Q</Text>
              <Text style={styles.tagline}>Your Safety, Our Priority</Text>
            </View>

            {/* Form Section */}
            <View style={styles.formSection}>
              <Text style={styles.welcomeTitle}>Welcome Back</Text>
              <Text style={styles.welcomeSubtitle}>Sign in to continue</Text>

              {/* Email Input - Empty Icon */}
              <View style={styles.inputWrapper}>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.input}
                    placeholder="Email Address"
                    placeholderTextColor="#64748B"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              {/* Password Input - Empty Icon */}
              <View style={styles.inputWrapper}>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#64748B"
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
                      size={22}
                      color="#818CF8"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Forgot Password */}
              <TouchableOpacity style={styles.forgotPassword}>
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>

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
                    <Text style={styles.loginButtonText}>Sign In</Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Sign Up Link */}
              <View style={styles.signUpSection}>
                <Text style={styles.signUpText}>Don't have an account? </Text>
                <TouchableOpacity onPress={() => router.push('/auth/register')}>
                  <View style={styles.signUpButton}>
                    <Text style={styles.signUpButtonText}>Sign Up</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Admin Portal Link */}
            <TouchableOpacity
              style={styles.adminPortalLink}
              onPress={() => router.push('/admin/login')}
              activeOpacity={0.7}
            >
              <View style={styles.adminIconContainer}>
                <Ionicons name="shield" size={18} color="#6366F1" />
              </View>
              <Text style={styles.adminPortalText}>Admin Portal</Text>
            </TouchableOpacity>

          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E21',
  },
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '60%',
    backgroundColor: '#1E1B4B',
    opacity: 0.6,
  },
  gradientOverlay2: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: '#312E81',
    opacity: 0.3,
  },
  topLeftGlow: {
    position: 'absolute',
    top: -100,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#6366F1',
    opacity: 0.15,
  },
  bottomRightGlow: {
    position: 'absolute',
    bottom: -150,
    right: -100,
    width: 350,
    height: 350,
    borderRadius: 175,
    backgroundColor: '#4F46E5',
    opacity: 0.1,
  },
  geometricPattern: {
    position: 'absolute',
    top: 60,
    right: 20,
    opacity: 0.1,
  },
  hexagon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#818CF8',
    position: 'absolute',
  },
  hexagon2: {
    top: 50,
    right: 30,
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  hexagon3: {
    top: 20,
    right: 80,
    width: 25,
    height: 25,
    borderRadius: 12.5,
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
  logoSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6366F1',
    opacity: 0.3,
  },
  logoIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  logoImage: {
    width: 96,
    height: 96,
  },
  logoRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#818CF8',
    opacity: 0.5,
  },
  appName: {
    fontSize: 42,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 4,
    marginTop: 8,
  },
  tagline: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
    letterSpacing: 1,
  },
  formSection: {
    marginBottom: 32,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 32,
  },
  inputWrapper: {
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  eyeButton: {
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: '#818CF8',
    fontSize: 14,
    fontWeight: '500',
  },
  loginButton: {
    backgroundColor: '#6366F1',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
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
    gap: 8,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
    gap: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
  },
  dividerText: {
    color: '#64748B',
    fontSize: 14,
  },
  signUpSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signUpText: {
    color: '#94A3B8',
    fontSize: 15,
  },
  signUpButton: {
    paddingHorizontal: 8,
  },
  signUpButtonText: {
    color: '#818CF8',
    fontSize: 15,
    fontWeight: '600',
  },
  adminPortalLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 16,
  },
  adminIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminPortalText: {
    color: '#818CF8',
    fontSize: 14,
    fontWeight: '500',
  },
});
