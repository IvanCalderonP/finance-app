import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Finance App</Text>
      <Text style={styles.message}>Proyecto configurado correctamente</Text>
      <Link href="/storage-lab" style={styles.message}>Abrir prueba técnica SQLite (solo datos sintéticos)</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: '#111111',
  },
  message: {
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
    color: '#333333',
  },
});
