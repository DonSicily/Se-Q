import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import axios from 'axios';
import { saveAuthData, clearAuthData } from '../../utils/auth';
import BACKEND_URL from '../../utils/config';

// AMENDMENT 4: setupPushNotifications import removed — push notifications
// are disabled for this app. See utils/notifications.ts for details.

// AMENDMENT (font): Eurostile Bold Extended — place the TTF file at:
//   frontend/assets/fonts/orbitron-black.ttf
// The font is loaded via expo-font's useFonts hook.  Until the file is present
// the text falls back to the system sans-serif (the style is still applied so
// the layout will not shift once the real file is dropped in).

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [fontsLoaded] = useFonts({
    'orbitron-black': require('../../assets/fonts/orbitron-black.ttf'),
  });

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

      // AMENDMENT 4: push notification setup call removed.

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
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoText}>Se-Q</Text>
            </View>
            <Text style={styles.subtitle}>Welcome Back</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color="#64748B" />
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#64748B"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color="#64748B" />
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
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.loginButton} onPress={handleLogin} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginButtonText}>Login</Text>}
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => router.push('/auth/register')}>
                <Text style={styles.linkText}>Sign Up</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.adminLink} onPress={() => router.push('/admin/login')}>
              <Ionicons name="shield-checkmark" size={18} color="#8B5CF6" />
              <Text style={styles.adminLinkText}>Admin Portal</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0F172A' },
  keyboardView:    { flex: 1 },
  scrollContent:   { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  header:          { alignItems: 'center', marginBottom: 48 },
  logoContainer:   { marginBottom: 8, paddingHorizontal: 16, paddingVertical: 6 },
  logoText:        { fontSize: 45, color: '#fff', letterSpacing: 6, fontFamily: 'orbitron-black' },
  subtitle:        { fontSize: 16, color: '#94A3B8', marginTop: 8 },
  form:            { width: '100%' },
  inputContainer:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  input:           { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 16, marginLeft: 12 },
  adminLink:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 32, paddingVertical: 12 },
  adminLinkText:   { fontSize: 14, color: '#8B5CF6', fontWeight: '500' },
  loginButton:     { backgroundColor: '#EF4444', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  loginButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  footer:          { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText:      { color: '#94A3B8', fontSize: 14 },
  linkText:        { color: '#3B82F6', fontSize: 14, fontWeight: '600' },
});
