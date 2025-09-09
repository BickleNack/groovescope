const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// Initialize Supabase client for health check
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Health check endpoint
router.get('/', async (req, res) => {
  const healthCheck = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    service: 'GrooveScope Backend',
    version: '1.0.0',
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    checks: {
      server: 'healthy',
      supabase: 'unknown',
      rapidapi: 'unknown'
    }
  };

  try {
    // Check Supabase connection
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      const { error } = await supabase.from('audio_cache').select('count').limit(1);
      healthCheck.checks.supabase = error ? 'unhealthy' : 'healthy';
    }

    // Check RapidAPI key presence
    healthCheck.checks.rapidapi = process.env.RAPIDAPI_KEY ? 'configured' : 'not_configured';

    // Determine overall status
    const hasUnhealthy = Object.values(healthCheck.checks).some(status => 
      status === 'unhealthy' || status === 'not_configured'
    );
    
    if (hasUnhealthy) {
      healthCheck.status = 'degraded';
      return res.status(200).json(healthCheck);
    }

    res.status(200).json(healthCheck);
  } catch (error) {
    console.error('Health check error:', error);
    
    healthCheck.status = 'unhealthy';
    healthCheck.error = error.message;
    
    res.status(503).json(healthCheck);
  }
});

// Detailed health check with dependencies
router.get('/detailed', async (req, res) => {
  const detailedHealth = {
    timestamp: new Date().toISOString(),
    service: 'GrooveScope Backend',
    version: '1.0.0',
    status: 'healthy',
    dependencies: {
      supabase: {
        status: 'unknown',
        responseTime: null,
        lastChecked: new Date().toISOString()
      },
      rapidapi: {
        status: 'unknown',
        configured: Boolean(process.env.RAPIDAPI_KEY),
        lastChecked: new Date().toISOString()
      }
    },
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      platform: process.platform,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    }
  };

  try {
    // Test Supabase connection
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      const startTime = Date.now();
      const { error } = await supabase.from('audio_cache').select('count').limit(1);
      const responseTime = Date.now() - startTime;
      
      detailedHealth.dependencies.supabase = {
        status: error ? 'unhealthy' : 'healthy',
        responseTime,
        lastChecked: new Date().toISOString(),
        error: error?.message
      };
    }

    // Check RapidAPI configuration
    detailedHealth.dependencies.rapidapi.status = 
      process.env.RAPIDAPI_KEY ? 'configured' : 'not_configured';

    // Determine overall status
    const supabaseHealthy = detailedHealth.dependencies.supabase.status === 'healthy';
    const rapidApiConfigured = detailedHealth.dependencies.rapidapi.status === 'configured';
    
    if (!supabaseHealthy || !rapidApiConfigured) {
      detailedHealth.status = 'degraded';
    }

    res.status(200).json(detailedHealth);
  } catch (error) {
    console.error('Detailed health check error:', error);
    
    detailedHealth.status = 'unhealthy';
    detailedHealth.error = error.message;
    
    res.status(503).json(detailedHealth);
  }
});

module.exports = router;
