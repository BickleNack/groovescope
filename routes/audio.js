const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const youtubeService = require('../services/youtubeService');

const router = express.Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Start processing YouTube video (returns immediately with job ID)
router.post('/process', async (req, res) => {
  try {
    const { youtubeUrl, quality = 'medium' } = req.body;

    // Validate input
    if (!youtubeUrl) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'youtubeUrl is required'
      });
    }

    // Validate YouTube URL
    const videoId = youtubeService.extractVideoId(youtubeUrl);
    if (!videoId) {
      return res.status(400).json({
        error: 'Invalid YouTube URL',
        message: 'Please provide a valid YouTube video URL'
      });
    }

    console.log(`Processing YouTube video: ${videoId}`);

    // Check cache first
    const { data: cachedData, error: cacheError } = await supabase
      .from('audio_cache')
      .select('*')
      .eq('video_id', videoId)
      .eq('quality', quality)
      .single();

    if (!cacheError && cachedData) {
      console.log(`Cache hit for video: ${videoId}`);
      return res.json({
        success: true,
        status: 'completed',
        cached: true,
        data: {
          videoId,
          quality,
          audioUrl: cachedData.audio_url,
          metadata: cachedData.metadata,
          createdAt: cachedData.created_at
        }
      });
    }

    // Get download information from the new API (much faster!)
    console.log(`Getting download info for video: ${videoId}`);
    const conversionJob = await youtubeService.startConversion(youtubeUrl, quality);

    if (!conversionJob || !conversionJob.downloadUrl) {
      return res.status(500).json({
        error: 'Download info failed',
        message: 'Unable to get download information for the YouTube video'
      });
    }

    // No audio processing needed - just return the download URL for WaveSurfer
    console.log(`Returning audio URL for video: ${videoId}`);

    // Prepare metadata (no audio processing needed)
    const metadata = {
      title: conversionJob.title || 'Unknown Title',
      author: conversionJob.metadata?.author,
      viewCount: conversionJob.metadata?.viewCount,
      thumbnail: conversionJob.metadata?.thumbnail,
      processedAt: new Date().toISOString()
    };

    // Cache the results (just metadata and audio URL)
    const { error: insertError } = await supabase
      .from('audio_cache')
      .upsert({
        video_id: videoId,
        quality,
        audio_url: conversionJob.downloadUrl,
        metadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Cache insertion error:', insertError);
      // Continue without caching - don't fail the request
    }

    // Return the audio URL for WaveSurfer to process
    res.json({
      success: true,
      status: 'completed',
      cached: false,
      data: {
        videoId,
        quality,
        audioUrl: conversionJob.downloadUrl,
        metadata,
        processedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Audio processing error:', error);

    // Handle specific error types
    if (error.message.includes('rate limit')) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter: 60
      });
    }

    if (error.message.includes('not found') || error.message.includes('unavailable')) {
      return res.status(404).json({
        error: 'Video not found',
        message: 'The YouTube video is not available or does not exist'
      });
    }

    if (error.message.includes('private') || error.message.includes('restricted')) {
      return res.status(403).json({
        error: 'Video access restricted',
        message: 'This video is private or restricted and cannot be processed'
      });
    }

    res.status(500).json({
      error: 'Processing failed',
      message: 'An error occurred while starting the processing',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

// Check conversion job status
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: 'Missing parameter',
        message: 'jobId is required'
      });
    }

    // Check job status in database
    const { data: jobData, error: jobError } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('job_id', jobId)
      .single();

    if (jobError || !jobData) {
      return res.status(404).json({
        error: 'Job not found',
        message: 'No processing job found with this ID'
      });
    }

    // If already completed, check for cached results
    if (jobData.status === 'completed') {
      const { data: cachedData, error: cacheError } = await supabase
        .from('audio_cache')
        .select('*')
        .eq('video_id', jobData.video_id)
        .eq('quality', jobData.quality)
        .single();

      if (!cacheError && cachedData) {
        return res.json({
          success: true,
          status: 'completed',
          jobId,
          data: {
            videoId: jobData.video_id,
            quality: jobData.quality,
            peaks: cachedData.peaks,
            duration: cachedData.duration,
            metadata: cachedData.metadata,
            completedAt: jobData.completed_at
          }
        });
      }
    }

    // Return current job status
    res.json({
      success: true,
      status: jobData.status,
      jobId,
      videoId: jobData.video_id,
      quality: jobData.quality,
      startedAt: jobData.started_at,
      completedAt: jobData.completed_at,
      error: jobData.error_message,
      estimatedTimeRemaining: jobData.status === 'converting' ? 
        calculateRemainingTime(jobData.started_at) : null
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      error: 'Status check failed',
      message: 'An error occurred while checking job status'
    });
  }
});

// Get cached peaks data by video ID
router.get('/peaks/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { quality = 'medium' } = req.query;

    if (!videoId) {
      return res.status(400).json({
        error: 'Missing parameter',
        message: 'videoId is required'
      });
    }

    const { data, error } = await supabase
      .from('audio_cache')
      .select('*')
      .eq('video_id', videoId)
      .eq('quality', quality)
      .single();

    if (error || !data) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No cached data found for this video'
      });
    }

    res.json({
      success: true,
      data: {
        videoId,
        quality,
        peaks: data.peaks,
        duration: data.duration,
        metadata: data.metadata,
        cachedAt: data.created_at
      }
    });

  } catch (error) {
    console.error('Cache retrieval error:', error);
    res.status(500).json({
      error: 'Cache retrieval failed',
      message: 'An error occurred while retrieving cached data'
    });
  }
});

// Clear cache for a specific video
router.delete('/cache/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;

    if (!videoId) {
      return res.status(400).json({
        error: 'Missing parameter',
        message: 'videoId is required'
      });
    }

    const { error } = await supabase
      .from('audio_cache')
      .delete()
      .eq('video_id', videoId);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: `Cache cleared for video: ${videoId}`
    });

  } catch (error) {
    console.error('Cache deletion error:', error);
    res.status(500).json({
      error: 'Cache deletion failed',
      message: 'An error occurred while clearing the cache'
    });
  }
});

// Get processing status and statistics
router.get('/stats', async (req, res) => {
  try {
    const { data: totalCount, error: countError } = await supabase
      .from('audio_cache')
      .select('video_id', { count: 'exact' });

    const { data: recentCount, error: recentError } = await supabase
      .from('audio_cache')
      .select('video_id', { count: 'exact' })
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (countError || recentError) {
      throw countError || recentError;
    }

    res.json({
      success: true,
      stats: {
        totalProcessed: totalCount?.length || 0,
        processedLast24h: recentCount?.length || 0,
        cacheEnabled: Boolean(process.env.SUPABASE_URL),
        apiConfigured: Boolean(process.env.RAPIDAPI_KEY)
      }
    });

  } catch (error) {
    console.error('Stats retrieval error:', error);
    res.status(500).json({
      error: 'Stats retrieval failed',
      message: 'An error occurred while retrieving statistics'
    });
  }
});

// Helper function to calculate remaining time
function calculateRemainingTime(startedAt) {
  const elapsed = Date.now() - new Date(startedAt).getTime();
  const averageTime = 90000; // 90 seconds average
  const remaining = Math.max(0, averageTime - elapsed);
  return Math.ceil(remaining / 1000); // Return seconds
}

// Background processing function
async function processVideoInBackground(conversionJob, videoId, quality, youtubeUrl) {
  try {
    console.log(`Starting background processing for job: ${conversionJob.id}`);
    
    let finalDownloadUrl;
    
    // Use appropriate monitoring method based on job type
    if (conversionJob.sseUrl) {
      console.log(`Using SSE monitoring for job: ${conversionJob.id}`);
      
      // Monitor progress with SSE and update job status
      finalDownloadUrl = await youtubeService.monitorConversionProgress(
        conversionJob.sseUrl,
        async (progressData) => {
          // Update job progress in database
          await supabase
            .from('processing_jobs')
            .update({
              metadata: {
                ...conversionJob.metadata,
                progress: progressData.progress || 0,
                status: progressData.status,
                lastUpdate: new Date().toISOString()
              }
            })
            .eq('job_id', conversionJob.id);
        }
      );
    } else if (conversionJob.downloadUrl) {
      console.log(`Using polling method for job: ${conversionJob.id}`);
      
      // Fall back to polling method
      finalDownloadUrl = await youtubeService.waitForConversion(
        conversionJob.downloadUrl, 
        conversionJob.id,
        20 // Reduced max attempts for background processing
      );
    } else {
      throw new Error('No monitoring method available for this job');
    }

    console.log(`Conversion completed for job: ${conversionJob.id}`);

    // Generate peaks from the downloaded audio
    console.log(`Processing audio to generate peaks for video: ${videoId}`);
    const peaksData = await audioProcessor.generatePeaks(finalDownloadUrl);

    // Prepare metadata
    const metadata = {
      title: conversionJob.title || 'Unknown Title',
      duration: peaksData.duration,
      sampleRate: peaksData.sampleRate,
      channels: peaksData.channels,
      processedAt: new Date().toISOString()
    };

    // Cache the results
    const { error: insertError } = await supabase
      .from('audio_cache')
      .upsert({
        video_id: videoId,
        quality,
        peaks: peaksData.peaks,
        duration: peaksData.duration,
        metadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Cache insertion error:', insertError);
    } else {
      console.log(`Successfully cached peaks for video: ${videoId}`);
    }

    // Update job status to completed
    const { error: updateError } = await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        peaks_generated: true
      })
      .eq('job_id', conversionJob.id);

    if (updateError) {
      console.error('Job update error:', updateError);
    }

    console.log(`Background processing completed for job: ${conversionJob.id}`);

  } catch (error) {
    console.error(`Background processing failed for job: ${conversionJob.id}`, error);

    // Update job status to failed
    await supabase
      .from('processing_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error.message
      })
      .eq('job_id', conversionJob.id);
  }
}

module.exports = router;
