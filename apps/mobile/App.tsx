import React, { useState } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, SafeAreaView, StatusBar } from 'react-native';

interface MobileTask {
  id: string;
  title: string;
  priority: string;
  status: string;
}

export default function App() {
  const [tasks, setTasks] = useState<MobileTask[]>([
    { id: 'TSK-101', title: 'Initialize Organization Security Baseline', priority: 'High', status: 'In Progress' },
    { id: 'TSK-102', title: 'Verify Sentinel AI Background Daemons', priority: 'Urgent', status: 'In Progress' },
    { id: 'TSK-103', title: 'Confirm Merchant Bank Settlement Details', priority: 'Normal', status: 'Completed' }
  ]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Task Tracker Mobile</Text>
        <Text style={styles.headerSubtitle}>Zero-Trust Operations & Sentinel AI</Text>
      </View>

      <View style={styles.metricsContainer}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>100%</Text>
          <Text style={styles.metricLabel}>Sentinel Health</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>$1/mo</Text>
          <Text style={styles.metricLabel}>Commercial</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>3</Text>
          <Text style={styles.metricLabel}>Active Tasks</Text>
        </View>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Assigned Operational Tasks</Text>
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.taskCard}>
              <View style={styles.taskHeader}>
                <Text style={styles.taskId}>{item.id}</Text>
                <Text style={[styles.priorityBadge, item.priority === 'Urgent' ? styles.urgentBadge : styles.highBadge]}>
                  {item.priority}
                </Text>
              </View>
              <Text style={styles.taskTitle}>{item.title}</Text>
              <Text style={styles.taskStatus}>Status: {item.status}</Text>
            </View>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a'
  },
  header: {
    padding: 20,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff'
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4
  },
  metricsContainer: {
    flexDirection: 'row',
    padding: 16,
    justifyContent: 'space-between'
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  metricValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#10b981'
  },
  metricLabel: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 4
  },
  content: {
    flex: 1,
    padding: 16
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 12
  },
  taskCard: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6
  },
  taskId: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#38bdf8'
  },
  priorityBadge: {
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6
  },
  highBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    color: '#fbbf24'
  },
  urgentBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    color: '#f87171'
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 6
  },
  taskStatus: {
    fontSize: 11,
    color: '#64748b'
  }
});
