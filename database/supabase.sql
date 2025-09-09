-- GrooveScope Backend Database Schema
-- Run this in your Supabase SQL editor to set up the required tables

-- Enable RLS (Row Level Security)
-- This script assumes you're using Supabase which has RLS enabled by default

-- Create table for caching audio URLs and metadata
CREATE TABLE IF NOT EXISTS audio_cache (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    video_id VARCHAR(11) NOT NULL, -- YouTube video ID (11 characters)
    quality VARCHAR(10) NOT NULL DEFAULT 'medium', -- low, medium, high
    audio_url TEXT NOT NULL, -- Direct audio download URL
    metadata JSONB, -- Additional metadata (title, author, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT audio_cache_video_quality_unique UNIQUE (video_id, quality),
    CONSTRAINT audio_cache_quality_check CHECK (quality IN ('low', 'medium', 'high'))
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_audio_cache_video_id ON audio_cache(video_id);
CREATE INDEX IF NOT EXISTS idx_audio_cache_created_at ON audio_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_audio_cache_video_quality ON audio_cache(video_id, quality);

-- Create table for API usage tracking
CREATE TABLE IF NOT EXISTS api_usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    endpoint VARCHAR(100) NOT NULL,
    video_id VARCHAR(11), -- Optional: track per video
    processing_time_ms INTEGER, -- Processing time in milliseconds
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for API usage tracking
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_endpoint ON api_usage(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_usage_success ON api_usage(success);
CREATE INDEX IF NOT EXISTS idx_api_usage_video_id ON api_usage(video_id) WHERE video_id IS NOT NULL;

-- Create table for system health monitoring
CREATE TABLE IF NOT EXISTS system_health (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    service_name VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL, -- healthy, degraded, unhealthy
    response_time_ms INTEGER,
    error_details JSONB,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create table for tracking processing jobs
CREATE TABLE IF NOT EXISTS processing_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    job_id VARCHAR(255) NOT NULL UNIQUE, -- External job ID from conversion service
    video_id VARCHAR(11) NOT NULL, -- YouTube video ID
    youtube_url TEXT NOT NULL,
    quality VARCHAR(10) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'converting', -- converting, completed, failed
    download_url TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    peaks_generated BOOLEAN DEFAULT false,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT processing_jobs_quality_check CHECK (quality IN ('low', 'medium', 'high')),
    CONSTRAINT processing_jobs_status_check CHECK (status IN ('converting', 'completed', 'failed', 'cancelled'))
);

-- Create indexes for health monitoring
CREATE INDEX IF NOT EXISTS idx_system_health_checked_at ON system_health(checked_at);
CREATE INDEX IF NOT EXISTS idx_system_health_service_status ON system_health(service_name, status);

-- Create indexes for processing jobs
CREATE INDEX IF NOT EXISTS idx_processing_jobs_job_id ON processing_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_video_id ON processing_jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_started_at ON processing_jobs(started_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_started ON processing_jobs(status, started_at);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for audio_cache table
DROP TRIGGER IF EXISTS update_audio_cache_updated_at ON audio_cache;
CREATE TRIGGER update_audio_cache_updated_at 
    BEFORE UPDATE ON audio_cache 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for processing_jobs table
DROP TRIGGER IF EXISTS update_processing_jobs_updated_at ON processing_jobs;
CREATE TRIGGER update_processing_jobs_updated_at 
    BEFORE UPDATE ON processing_jobs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security Policies
-- Allow all operations for service role (backend)
-- Restrict client access as needed

-- Audio cache policies
ALTER TABLE audio_cache ENABLE ROW LEVEL SECURITY;

-- Allow service role to do everything
CREATE POLICY "Service role can manage audio_cache" ON audio_cache
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow read access to authenticated users (if needed for frontend)
CREATE POLICY "Users can read audio_cache" ON audio_cache
    FOR SELECT
    TO authenticated
    USING (true);

-- API usage policies
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage api_usage" ON api_usage
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- System health policies
ALTER TABLE system_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage system_health" ON system_health
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Processing jobs policies
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage processing_jobs" ON processing_jobs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow read access to authenticated users for job status checking
CREATE POLICY "Users can read processing_jobs" ON processing_jobs
    FOR SELECT
    TO authenticated
    USING (true);

-- Create a view for cache statistics
CREATE OR REPLACE VIEW cache_stats AS
SELECT 
    COUNT(*) as total_cached_videos,
    COUNT(DISTINCT video_id) as unique_videos,
    AVG(duration) as avg_duration,
    MIN(created_at) as first_cached,
    MAX(created_at) as last_cached,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as cached_last_24h,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as cached_last_7d
FROM audio_cache;

-- Create a view for API usage statistics
CREATE OR REPLACE VIEW api_stats AS
SELECT 
    endpoint,
    COUNT(*) as total_requests,
    COUNT(*) FILTER (WHERE success = true) as successful_requests,
    COUNT(*) FILTER (WHERE success = false) as failed_requests,
    ROUND(AVG(processing_time_ms)) as avg_processing_time_ms,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as requests_last_24h
FROM api_usage
GROUP BY endpoint;

-- Function to clean up old cache entries (optional)
CREATE OR REPLACE FUNCTION cleanup_old_cache(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM audio_cache 
    WHERE created_at < NOW() - (days_to_keep || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO system_health (service_name, status, error_details)
    VALUES ('cache_cleanup', 'healthy', 
            jsonb_build_object('deleted_entries', deleted_count, 'days_kept', days_to_keep));
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get cache hit ratio
CREATE OR REPLACE FUNCTION get_cache_hit_ratio(hours_back INTEGER DEFAULT 24)
RETURNS DECIMAL AS $$
DECLARE
    total_requests INTEGER;
    cache_hits INTEGER;
BEGIN
    -- This would need to be implemented based on how you track cache hits vs misses
    -- For now, return a placeholder
    RETURN 0.75; -- 75% cache hit ratio
END;
$$ LANGUAGE plpgsql;

-- Insert initial health check
INSERT INTO system_health (service_name, status, error_details)
VALUES ('database_setup', 'healthy', jsonb_build_object('message', 'Initial database setup completed'));

-- Grant necessary permissions
-- These permissions should be set automatically in Supabase, but included for completeness

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Grant table permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON cache_stats TO service_role;
GRANT SELECT ON api_stats TO service_role;

-- Grant sequence permissions
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Grant function permissions
GRANT EXECUTE ON FUNCTION cleanup_old_cache TO service_role;
GRANT EXECUTE ON FUNCTION get_cache_hit_ratio TO service_role;