-- FlowCube Database Function
-- 创建存储过程：自动更新用户累计时间统计

-- 创建更新用户统计的函数
CREATE OR REPLACE FUNCTION update_user_stats(
  p_user_id UUID,
  p_duration INTEGER,
  p_mode TEXT
)
RETURNS VOID AS $$
BEGIN
  -- 根据模式更新对应的累计时间
  IF p_mode = 'study' THEN
    UPDATE users
    SET 
      total_study_duration = COALESCE(total_study_duration, 0) + p_duration,
      total_sessions = COALESCE(total_sessions, 0) + 1
    WHERE id = p_user_id;
  ELSIF p_mode = 'exercise' THEN
    UPDATE users
    SET 
      total_exercise_duration = COALESCE(total_exercise_duration, 0) + p_duration,
      total_sessions = COALESCE(total_sessions, 0) + 1
    WHERE id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 添加函数注释
COMMENT ON FUNCTION update_user_stats IS '用户完成专注会话后自动更新累计时间统计';

-- 验证函数创建成功
SELECT 
  routine_name as function_name,
  routine_schema as schema_name
FROM information_schema.routines
WHERE routine_name = 'update_user_stats'
  AND routine_schema = 'public';

-- 测试函数（可选）
-- SELECT update_user_stats('你的用户 ID', 1800, 'study');

SELECT 'Function created successfully!' as status;
