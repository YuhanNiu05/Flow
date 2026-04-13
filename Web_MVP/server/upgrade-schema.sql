-- FlowCube Database Schema Upgrade
-- 添加累计时间统计字段到 users 表

-- 1. 添加累计时间字段到 users 表
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS total_study_duration INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_exercise_duration INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_sessions INTEGER DEFAULT 0;

-- 2. 添加字段注释
COMMENT ON COLUMN users.total_study_duration IS '累计学习总时长（秒）';
COMMENT ON COLUMN users.total_exercise_duration IS '累计运动总时长（秒）';
COMMENT ON COLUMN users.total_sessions IS '累计专注总次数';

-- 3. 验证字段添加成功
SELECT 
  column_name, 
  data_type, 
  column_default
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('total_study_duration', 'total_exercise_duration', 'total_sessions')
ORDER BY ordinal_position;

-- 4. (可选) 初始化现有用户的累计数据
-- 如果有历史数据，运行以下 SQL 计算并填充
/*
UPDATE users u
SET 
  total_study_duration = COALESCE((
    SELECT SUM(actual_duration) 
    FROM focus_sessions fs 
    WHERE fs.user_id = u.id 
      AND fs.mode = 'study' 
      AND fs.status = 'completed'
  ), 0),
  total_exercise_duration = COALESCE((
    SELECT SUM(actual_duration) 
    FROM focus_sessions fs 
    WHERE fs.user_id = u.id 
      AND fs.mode = 'exercise' 
      AND fs.status = 'completed'
  ), 0),
  total_sessions = COALESCE((
    SELECT COUNT(*) 
    FROM focus_sessions fs 
    WHERE fs.user_id = u.id 
      AND fs.status = 'completed'
  ), 0);
*/

-- 5. 验证修改
SELECT 'Schema upgrade completed!' as status;
